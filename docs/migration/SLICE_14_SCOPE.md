# SLICE_14_SCOPE.md — Cadrage de la Slice 14
> Basé sur `booking_routes.py:984–1028` (branche `elif new_status == "completed"` du dispatcher legacy).
> Généré le 2026-02-XX.

---

## Justification du choix — `POST /bookings/{id}/complete`

### Pourquoi "complete" après accept ?

| Critère | Valeur |
|---|---|
| Suite directe | refuse (S12) + accept (S13) + **complete (S14)** = la triade receiver complète |
| Zéro Stripe | Aucun appel Stripe dans la branche `completed` — 100 % conforme aux contraintes |
| Zéro remboursement | Pas de `create_refund`, pas de `cancel_payment_intent` |
| Acteur unique | Receiver OU admin uniquement (plus simple que cancel : 3 acteurs) |
| Risque FAIBLE | 3 UPDATEs atomiques, 0 dépendance externe |
| Terminal | `completed` est l'état final positif du booking — ferme la boucle métier |

### Comparaison des candidats retenus

| Endpoint | Stripe requis | Remboursement | Acteurs | Complexité |
|---|---|---|---|---|
| `POST /bookings/{id}/complete` ✅ | **AUCUN** | **NON** | Receiver + admin | **FAIBLE** |
| `POST /bookings/{id}/cancel` | Oui (PI cancel) + possible refund | OUI si capturé | Payer + Receiver + Admin | ÉLEVÉ |
| `POST /bookings/{id}/pay` | Stripe Checkout obligatoire | NON | Payer | ÉLEVÉ |

`complete` est la seule option qui respecte strictement les deux contraintes utilisateur :
- `cancel` → `cancel_payment_intent` + `create_refund` possible → **Stripe avancé**
- `pay` → `create_checkout_session` → **Stripe complet**

---

## Avertissement : pas d'endpoint dédié en Python

> ⚠️ Il n'existe PAS de `POST /bookings/{booking_id}/complete` en Python.
>
> La logique `completed` est embarquée dans le **dispatcher legacy** `PATCH /api/bookings/{booking_id}/status`
> à la branche `elif new_status == "completed"` (lignes 999–1026).
>
> La recommandation Java est de créer un endpoint **dédié** `POST /api/bookings/{bookingId}/complete`
> qui expose cette logique nativement, aligné sur l'architecture `/accept` et `/refuse`.

### Montage actuel en Python

```
PATCH /api/bookings/{booking_id}/status   (body: {"status": "completed"})
  → booking_routes.py:984–1028
  → Montage : api_router.include_router(booking_router) — server.py:101
```

---

## Endpoints inclus

| # | Méthode Python | Chemin Python | Méthode Java | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|---|---|
| 1 | PATCH | `/api/bookings/{booking_id}/status` (status=completed) | POST | `/api/bookings/{bookingId}/complete` | `booking_routes.py` | 984–1028 |

---

## Auth

```python
# booking_routes.py:1003–1009
user = await require_auth(request, pool)
row = await conn.fetchrow(
    "SELECT receiver_user_id FROM bookings WHERE booking_id=$1", booking_id
)
if dict(row)["receiver_user_id"] != user["user_id"] and user.get("role") != "admin":
    raise HTTPException(403, "Seul le bénéficiaire peut marquer comme terminé")
```

- Auth **STRICTE** — 401 si token absent/invalide
- **Receiver OU admin** (identique à `/accept`, différent de `/refuse` : receiver uniquement)

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Table `bookings` | DB | Lecture `receiver_user_id` + UPDATE `status` |
| Table `service_slots` | DB (conditionnel) | UPDATE `slot_status` via sous-requête corrélée |
| Table `payments` | DB (conditionnel) | UPDATE `status` si `authorized` → DB uniquement |
| ~~Stripe~~ | **EXCLU** | Aucun appel Stripe dans cette branche |
| ~~Push notification~~ | **ABSENT** | Aucun `_push()` dans le code Python |

---

## Niveau de risque

**FAIBLE.**

| Point | Risque |
|---|---|
| Absence de garde sur statut courant | Python n'interdit aucun statut source → reproduire exactement |
| Sous-requête corrélée sur `service_slots` | Si `slot_id IS NULL` → UPDATE silencieux (comportement attendu) |
| `payments` : captured DB uniquement | Ne pas ajouter d'appel Stripe non prévu |
| Aucune notification push | Ne pas en ajouter |
| Idempotence implicite | Pas de garde explicite → 2e appel silencieux |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | **Pas de garde sur `status`** | Le code Python ne vérifie pas que `bk["status"]` est `accepted` ou `confirmed` avant UPDATE. N'importe quel booking peut être marqué `completed`. Java doit reproduire ce comportement (ou documenter l'écart). |
| P2 | **Sous-requête `service_slots`** | `WHERE slot_id = (SELECT slot_id FROM bookings WHERE booking_id=$1)` — si `slot_id IS NULL`, la sous-requête retourne NULL et l'UPDATE n'affecte aucune ligne. Pas d'erreur. |
| P3 | **Payments DB-only** | `UPDATE payments SET status='captured' ... WHERE status='authorized'` — AUCUN appel Stripe. Ce n'est qu'une mise à jour de statut interne. |
| P4 | **Aucune notification push** | `/accept` et `/refuse` appellent `_push()`. La branche `completed` du Python ne le fait PAS. Ne pas l'ajouter en Java. |
| P5 | **Idempotence implicite** | Si le booking est déjà `completed`, les UPDATEs s'exécutent sans erreur (conditions `WHERE slot_status='booked'` et `WHERE status='authorized'` ne matchent plus → 0 lignes). Aucun `early return` comme dans accept/refuse. |
