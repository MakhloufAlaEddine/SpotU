# SLICE_15_SCOPE.md — Cadrage de la Slice 15
> Basé sur `booking_routes.py:754–977`, `models.py:337–339`.
> Généré le 2026-02-XX.

---

## Justification du choix — `POST /bookings/{id}/cancel`

### Pourquoi cancel après complete ?

| Critère | Valeur |
|---|---|
| Complète le cycle | refuse (S12) + accept (S13) + complete (S14) + **cancel (S15)** = cycle booking complet côté utilisateur |
| Seule voie de sortie restante | La machine d'états booking n'a plus que `cancel` comme transition non documentée pour les utilisateurs finaux |
| Stripe partiellement présent | PI cancel = stub acceptable (identique à Slice 12). Refund = branche simple `create_refund(charge_id)` — 1 seule branche |
| Pas de remboursement multi-branches | Le refund Python est une seule condition : `if new_pay_status == "refunded" and charge_id` |
| Requis pour cohérence UX | Sans cancel, le payer ne peut pas se désengager d'une réservation qu'il a créée |

### Comparaison des candidats restants

| Endpoint | Stripe | Remboursement | Acteurs | Complexité |
|---|---|---|---|---|
| `POST /bookings/{id}/cancel` ✅ | Stub PI cancel + refund simple | Branche unique | Payer + Receiver + Admin | **MOYEN** |
| `POST /bookings/request` | NON | NON | Payer | ÉLEVÉ (pricing_engine, row-level lock) |
| `POST /bookings/{id}/pay` | Stripe Checkout obligatoire | NON | Payer | ÉLEVÉ (Stripe) |

---

## Avertissement : Stripe présent en deux points

> ⚠️ Contrairement aux Slices 12–14, `/cancel` appelle Stripe dans 2 scénarios.
>
> **Scénario A** — `payment_status IN (requires_authorization, authorized, capture_pending)` → `stripe_service.cancel_payment_intent(pi_id)` → stub acceptable (même pattern que Slice 12)
>
> **Scénario B** — `payment_status = captured` → `stripe_service.create_refund(charge_id, ...)` → remboursement réel.
>
> **Recommandation v1** : Scénario A = stub. Scénario B = acceptable (1 branche simple), mais peut être marqué "Phase Stripe future" si l'équipe Java veut reporter.
>
> Dans les deux cas, Stripe est **hors transaction DB** — comportement identique aux Slices précédentes.

---

## Endpoint inclus

| # | Méthode | Chemin Python | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/bookings/{booking_id}/cancel` | `/api/bookings/{bookingId}/cancel` | `booking_routes.py` | 754–977 |

**Montage :** `api_router.include_router(booking_router)` — `server.py:101`

---

## Auth

```python
# booking_routes.py:795–821
user = await require_auth(request, pool)
uid = user["user_id"]
is_admin    = user.get("role") == "admin"
is_payer    = uid in filter(None, [bk["user_id"], bk["payer_user_id"]])
is_receiver = uid == bk["receiver_user_id"]

if not (is_payer or is_receiver or is_admin):
    raise HTTPException(403, "Vous n'êtes pas autorisé à annuler cette réservation")
```

- Auth **STRICTE** — 401 si token absent/invalide
- **3 acteurs** : payer, receiver, admin — avec droits différents selon l'état du booking
- `is_payer` vérifie **les deux champs** : `user_id` ET `payer_user_id` (legacy support)

---

## Body

```python
# models.py:337–339
class CancelRequest(BaseModel):
    reason: Optional[str] = None  # raison libre, non obligatoire
```

```json
{ "reason": "string | null" }
```

Body entièrement **optionnel** — `body=None` est la valeur par défaut.

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Table `bookings` (LEFT JOIN payments) | DB | Lecture complète + UPDATE status |
| Table `payments` | DB (conditionnel) | UPDATE pay_status |
| Table `service_slots` | DB (conditionnel) | UPDATE slot_status → available |
| `stripe_service.cancel_payment_intent()` | Externe (stub v1 OK) | Annulation PI si non capturé |
| `stripe_service.create_refund()` | Externe (branche unique) | Remboursement si capturé |
| `send_push_to_user()` | Push externe | Notification (3 patterns selon acteur) |

---

## Niveau de risque

**MOYEN.**

| Point | Risque |
|---|---|
| 3 acteurs avec droits asymétriques | Receiver ne peut annuler qu'en `accepted` — logique conditionnelle complexe |
| Matrice de statut payment | 4 branches (requires_auth/authorized/capture_pending → cancelled ; captured → refunded ; else → inchangé) |
| `charge_id` requis pour refund | Si capturé mais `charge_id` NULL → pas de Stripe + log warning (comportement silencieux) |
| `stripe_action` dans réponse | Champ dynamique (null / "pi_cancelled" / "refund_created") |
| 3 patterns de notifications | Admin → les deux ; Payer → receiver ; Receiver → payer |
| `is_payer` double champ | `uid in filter(None, [user_id, payer_user_id])` — legacy support |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | **Receiver : droit limité à `accepted`** | `if is_receiver and not is_payer and not is_admin: if bk["status"] != "accepted": raise 409`. Le receiver NE peut PAS annuler `requested` — il doit utiliser `/refuse` pour ça. |
| P2 | **`is_payer` vérifie deux colonnes** | `uid in filter(None, [bk["user_id"], bk["payer_user_id"]])` — les vieux bookings n'ont que `user_id`. Ne pas vérifier uniquement `payer_user_id`. |
| P3 | **Refund via `charge_id`, pas `payment_intent_id`** | `stripe_service.create_refund(charge_id=charge_id, ...)` — si `charge_id` est NULL (proxy Emergent / PI sans capture physique), aucune action Stripe, juste un log WARNING. |
| P4 | **Ordre des guards** | 1) Vérification droits d'accès (403) → 2) Idempotence si `cancelled` (early return) → 3) Non-annulables (409) → 4) Transaction. Ne pas inverser l'ordre. |
| P5 | **États non annulables** | `completed`, `refused`, `expired` → HTTP 409. **`awaiting_payment`**, `accepted`, `confirmed`, `requested` sont annulables. |
| P6 | **`stripe_action` dans réponse** | Champ nullable : `None` si aucune action Stripe, `"pi_cancelled"` ou `"refund_created"` sinon. Java doit retourner ce champ. |
| P7 | **Admin notifie les DEUX parties** | Admin → `_push(payer)` + `_push(receiver)`. Payer → `_push(receiver)`. Receiver → `_push(payer)`. |
