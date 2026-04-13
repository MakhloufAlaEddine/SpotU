# SLICE_13_SCOPE.md — Cadrage de la Slice 13
> Basé sur `booking_routes.py:401–552`, `_get_pay_now_minutes:56–66`, `001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Justification du choix — `POST /bookings/{id}/accept`

### Pourquoi accept après refuse ?

| Critère | Valeur |
|---|---|
| Symétrie métier | `refuse` + `accept` = paire complète "receiver décide" — sans accept, le flux booking est incomplet |
| Même acteur principal | Receiver (+ admin exception, absente dans refuse) |
| Stripe optionnel en Cas B | Cas B (le plus courant) n'a aucun appel Stripe |
| Stripe stub en Cas A | Capture hors transaction + try/except → comportement identique à refuse |
| Idempotence native | Si déjà `awaiting_payment`/`accepted`/`confirmed` → retour immédiat |
| Aucun remboursement | Contrairement à `cancel` qui peut déclencher un remboursement Stripe |

### Comparaison des candidats

| Endpoint | Stripe requis | Remboursement | Acteurs | Complexité |
|---|---|---|---|---|
| `POST /bookings/{id}/accept` ✅ | Optionnel (Cas A seulement) | NON | Receiver + admin | **MOYEN** |
| `POST /bookings/{id}/cancel` | Obligatoire (cancel PI ou refund) | OUI possible | Payer + Receiver + Admin | ÉLEVÉ |
| `PATCH /bookings/{id}/status → completed` | NON | NON | Receiver + admin | FAIBLE mais legacy dispatcher |

`accept` est la suite la plus naturelle : avec `refuse` (Slice 12) elles forment la réponse complète du receiver à une demande entrante.

---

## Endpoint inclus

| # | Méthode | Chemin Python | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/bookings/{booking_id}/accept` | `/api/bookings/{bookingId}/accept` | `booking_routes.py` | 401–552 |

**Montage :** `api_router.include_router(booking_router)` — `server.py:101`

---

## Auth

```python
# booking_routes.py:421–445
user = await require_auth(request, pool)
if bk["receiver_user_id"] != user["user_id"] and user.get("role") != "admin":
    raise HTTPException(403, "Seul le bénéficiaire peut accepter cette réservation")
```

- Auth **STRICTE** — 401 si token absent/invalide
- **Receiver OU admin** (contrairement à `/refuse` : receiver uniquement)

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Table `bookings` | DB (JOIN services) | Lecture statut + payment_mode + expires_at |
| Table `services` | DB (JOIN) | `pay_later_expiration_minutes`, `booking_approval_mode` |
| Table `payments` | DB | Lecture PI ID + pay_status |
| Table `app_config` | DB | Lecture `pay_now_checkout_minutes` (Cas B + pay_now) |
| Table `service_slots` | DB (conditionnel) | UPDATE slot_status |
| `stripe_service.capture_payment_intent()` | Externe OPTIONNEL | Capture PI (Cas A uniquement) |
| `send_push_to_user()` | Push externe | Notification payer (fire-and-forget) |
| `_get_pay_now_minutes()` | Fonction interne | Lit config, fallback 30 min |

---

## Les 2 branches

### Cas A — `payment_mode = 'pay_now'` ET `pay_status = 'authorized'`

```
requested → confirmed
slot: pending/available/reserved → booked
payments: → captured
expires_at → NULL
Stripe: capture_payment_intent (hors transaction)
Push: "Réservation confirmée !"
Réponse: {success, status=confirmed, payment_mode, payment_captured=true}
```

### Cas B — Tous les autres cas (pay_later OU pay_now non encore autorisé)

```
requested → awaiting_payment
slot: pending/available → reserved
expires_at → NOW() + pay_expiry_minutes
Stripe: AUCUN
Push: "Réservation acceptée — paiement requis"
Réponse: {success, status=awaiting_payment, payment_mode, pay_expiry_interval}
```

---

## Niveau de risque

**MOYEN.**

| Point | Risque |
|---|---|
| 2 branches SQL distinctes | Chaque branche a sa propre transaction, ses propres champs mis à jour |
| Lecture app_config | Requête DB supplémentaire pour `pay_now_checkout_minutes` en Cas B |
| `expires_at` calculé | NOW() + timedelta côté application — résultat temps-dépendant |
| Stripe Cas A hors transaction | Stub acceptable, comportement identique à Slice 12 |
| Admin exception | `/accept` autorise l'admin — différent de `/refuse` |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Idempotence retourne le VRAI statut actuel | `return {"status": bk["status"]}` — si le booking est en `confirmed`, la réponse idempotente retourne `"status": "confirmed"` et non `"awaiting_payment"`. Ne pas hardcoder `"awaiting_payment"` dans la réponse idempotente. |
| P2 | Cas B expiry : 2 sources différentes | `payment_mode="pay_now"` → lire `app_config.pay_now_checkout_minutes` (SELECT DB), fallback 30 min. `payment_mode="pay_later"` → lire `service.pay_later_expiration_minutes` (déjà dans le JOIN), fallback 1440 min. |
| P3 | Cas A UPDATE bookings : 3 champs | `SET status='confirmed', payment_status='captured', expires_at=NULL, updated_at=NOW()` — ne pas oublier `payment_status` et `expires_at=NULL`. |
| P4 | Cas A : UPDATE payments sur `payment_id` (pas `booking_id`) | `UPDATE payments ... WHERE payment_id=$1` — le payment_id est lu dans la requête préalable. Conditionnel si `payment_id is not None`. |
| P5 | Cas B : slot → `reserved` (pas `booked`) | Cas A libère en `booked`, Cas B libère en `reserved`. Ce ne sont pas les mêmes états. |
| P6 | Garde TTL avant transition | Si `expires_at` est défini ET dans le passé → HTTP 410. La vérification precède toute modification DB. |
| P7 | `pay_expiry_interval` dans la réponse Cas B | Format exact : `"{n} minutes"` (string) — ex: `"30 minutes"`. Ce n'est pas un int ni un objet. |
