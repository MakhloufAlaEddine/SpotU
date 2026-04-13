# SLICE_12_SCOPE.md — Cadrage de la Slice 12
> Basé sur `booking_routes.py:675–747`, `001_initial_schema.sql:42–67, 203–228`.
> Généré le 2026-02-XX.

---

## Justification du choix — `POST /bookings/{id}/refuse`

### Comparaison des candidats write

| Endpoint | Stripe requis | Branches métier | Acteurs autorisés | Complexité |
|---|---|---|---|---|
| `POST /bookings/{id}/refuse` | OPTIONNEL (swallowed) | 1 seule | Receiver uniquement | **FAIBLE** ✅ |
| `POST /bookings/{id}/accept` | Optionnel (Cas A) | 2 branches + TTL + expiry calc | Receiver ou admin | MOYEN |
| `POST /bookings/{id}/cancel` | OBLIGATOIRE (cancel ou refund) | 3 acteurs × 3 statuts payment | Payer + Receiver + Admin | ÉLEVÉ |
| `POST /bookings/request` | OBLIGATOIRE (create PI) | pricing_engine + slots + workers | Payer | TRÈS ÉLEVÉ |
| `PATCH /bookings/{id}/status` | Via dispatch | Legacy dispatcher | Variable | N/A (wrapper) |

### Pourquoi `refuse` est le meilleur choix

1. **Machine d'états la plus simple** : une seule transition autorisée → `requested` → `refused`
2. **Contrôle d'accès trivial** : receiver uniquement — un seul champ à vérifier (`receiver_user_id`)
3. **Stripe isolé et optionnel** : l'appel Stripe est :
   - HORS de la transaction DB
   - Conditionnel (`if pi_row and pi_row["stripe_payment_intent_id"]`)
   - Entouré d'un try/except qui avale l'exception → le booking est refusé même si Stripe échoue
   - **En Java v1 : implémenter le stub, appel Stripe réel à activer en Slice Stripe**
4. **Push notification fire-and-forget** : `asyncio.create_task()` → non bloquant → en Java, `@Async` ou fire-and-forget
5. **Idempotent** : si déjà `refused` → retourner succès immédiatement
6. **Transaction simple** : 3 UPDATEs dans un seul bloc atomique
7. Zéro interaction avec `pricing_engine`, zéro calcul de slots concurrents

---

## Endpoint inclus

| # | Méthode | Chemin Python | Chemin Java | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/bookings/{booking_id}/refuse` | `/api/bookings/{bookingId}/refuse` | `booking_routes.py` | 675–747 |

**Montage :** `api_router.include_router(booking_router, tags=["bookings"])` — `server.py:101`

---

## Endpoints écriture exclus de cette slice

| Endpoint | Raison |
|---|---|
| `POST /bookings/{id}/accept` | 2 branches Stripe (capture vs awaiting_payment) + TTL + expiry calc |
| `POST /bookings/{id}/pay` | Stripe Checkout Session complète |
| `POST /bookings/{id}/cancel` | Stripe cancel + refund + 3 acteurs + 3 branches notification |
| `POST /bookings/request` | pricing_engine + Stripe PI création + slot FOR UPDATE NOWAIT + workers expiry |
| `PATCH /bookings/{id}/status` | Dispatcher legacy → traité en Slice à part après les autres verbes |

---

## Auth

```python
# booking_routes.py:684
user = await require_auth(request, pool)
# booking_routes.py:695-696
if bk["receiver_user_id"] != user["user_id"]:
    raise HTTPException(403, "Seul le bénéficiaire peut refuser cette réservation")
```

- Auth **STRICTE** — `require_auth` — 401 si token absent/invalide
- Seul le **receiver** peut refuser — pas d'exception admin ici (contrairement à cancel et accept)

---

## Dépendances

| Dépendance | Type | Rôle |
|---|---|---|
| Table `bookings` | DB | SELECT lecture + UPDATE statut |
| Table `payments` | DB | SELECT PI ID + UPDATE statut |
| Table `service_slots` | DB | UPDATE slot_status (conditionnel) |
| `stripe_service.cancel_payment_intent()` | Externe OPTIONNEL | Annulation PI Stripe hors transaction |
| `send_push_to_user()` | Push externe | Notification au payer (fire-and-forget) |
| `require_auth` | Auth | JWT + DB lookup |

---

## Niveau de risque

**FAIBLE.**

| Point | Risque |
|---|---|
| Stripe isolé | Appel hors transaction, try/except → aucun risque de rollback partiel |
| Slot conditionnel | `slot_status='pending'` uniquement → comportement intentionnel documenté |
| Payments filtre | `IN ('requires_authorization','authorized')` → peut ne rien modifier si absent |
| Push async | Fire-and-forget → aucun risque sur la transaction |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Stripe HORS transaction | L'appel Stripe est exécuté APRÈS la fermeture de la transaction. Si Stripe échoue, le booking est quand même en état `refused` en DB. En Java, même séquence : transaction DB → commit → appel Stripe. Ne JAMAIS inclure Stripe dans la transaction. |
| P2 | `user_id AS payer_user_id` dans le SELECT | Python lit `user_id AS payer_user_id` (alias) dans la requête de lecture. La colonne réelle est `bookings.user_id` (legacy payer). Utiliser ce champ pour la notification push. |
| P3 | UPDATE payments conditionnel | `WHERE booking_id=$1 AND status IN ('requires_authorization','authorized')` — si aucun payment n'existe ou si le statut est autre (ex: `pending`), 0 ligne mise à jour → comportement normal, pas d'erreur |
| P4 | UPDATE service_slots conditionnel | `WHERE slot_id=$1 AND slot_status='pending'` — libère uniquement les slots en état `pending`. Un slot en `reserved` ou `booked` n'est pas libéré. |
| P5 | Access control receiver strict | `bk["receiver_user_id"] != user["user_id"]` — pas de COALESCE sur `coach_id`. Un ancien booking avec `receiver_user_id=null, coach_id=coach` → le coach verra un 403. C'est le comportement Python actuel — le reproduire. |
| P6 | Pas de body JSON | L'endpoint ne lit aucun body — décorateur `@router.post` sans `Body(...)`. En Java : aucun `@RequestBody`, juste `@PathVariable`. |
