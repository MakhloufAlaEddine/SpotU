# SLICE_37_API_CONTRACTS.md — Audit price-preview (no-op)
> Basé sur `routes/booking_routes.py:115–158`, `SLICE_30_API_CONTRACTS.md`.
> Généré le 2026-04-26.

---

## ⚠️ Document de référence : `SLICE_30_API_CONTRACTS.md` § "Endpoint 1 — `POST /api/bookings/price-preview`"

S37 ne redéfinit pas le contrat. Il **vérifie** que la spec S30 est toujours valide.

---

## Contrat Python actuel (vérifié 2026-04-26)

### Endpoint : `POST /api/bookings/price-preview`

**Auth** : JWT obligatoire (`require_auth`).

**Body (JSON)** :
```json
{ "service_id": "svc_abc" }
```

**Erreurs** :
- 400 `{"detail": "service_id requis"}` si `service_id` manquant
- 401 si auth invalide (compat S34)
- 404 `{"detail": "Service introuvable ou inactif"}` si service absent ou `active=FALSE`

**Pipeline backend** :
```
1. require_auth → user.user_id (= payer_user_id)
2. body.service_id requis (sinon 400)
3. SELECT service_id, coach_id, price FROM services WHERE service_id=$1 AND active=TRUE
4. pricing_engine.compute_pricing(payer, receiver=coach_id, base=price, currency='EUR')
5. snap = pricing.to_snapshot()
6. retour 9 champs
```

**Réponse 200 (9 champs exactement)** :
```json
{
  "base_amount":                 50.00,
  "payer_fixed_fee":             0.50,
  "payer_percent_fee_amount":    1.25,
  "receiver_fixed_fee":          0.30,
  "receiver_percent_fee_amount": 0.75,
  "platform_total_fee":          2.80,
  "receiver_net_amount":         48.95,
  "payer_total_amount":          51.75,
  "currency":                    "EUR"
}
```

---

## Comparaison avec `SLICE_30_API_CONTRACTS.md`

| Aspect | Spec S30 | Code Python actuel | Divergence |
|---|---|---|---|
| Path `POST /api/bookings/price-preview` | ✅ | ✅ | — |
| Auth `require_auth` | ✅ | ✅ | — |
| Body `{service_id}` requis | ✅ | ✅ | — |
| 400 / 404 / 401 | ✅ | ✅ | — |
| SELECT services WHERE active=TRUE | ✅ | ✅ | — |
| Appel `pricing_engine.compute_pricing` | ✅ | ✅ | — |
| Response 9 champs | ✅ | ✅ | — |
| Currency hardcodée `'EUR'` | ✅ | ✅ | — |
| `product_type='service_booking'` hardcodé | ✅ | ✅ | — |

**Conclusion** : **0 divergence** entre spec S30 et Python actuel.

---

## Écarts éventuels — AUCUN

S30 couvre intégralement le contrat. Si une régression suspecte se manifeste côté Java (ex: response avec moins de champs, format Decimal incorrect), revoir directement `SLICE_30_API_CONTRACTS.md` qui contient la spec exacte.

---

## Effets de bord

**AUCUN.** Lecture pure (services). Pas d'écriture DB, pas de Stripe SDK, pas de notification.

---

## Notes pour Cursor

- **Si Cursor a livré S30** : l'endpoint est en prod. Aucune action S37.
- **Si Cursor n'a pas livré S30** : suivre `SLICE_30_CURSOR_IMPLEMENTATION_NOTES.md` strict (section "Endpoint 1 — Price Preview").
- **Si Cursor a livré S30 mais a un doute** : exécuter les cas `PRV-01` à `PRV-XX` documentés en `SLICE_30_TEST_CASES.md`.
