# SLICE_37_DB_MAPPING.md — Audit price-preview DB (no-op)
> Basé sur `routes/booking_routes.py:115–158`, `SLICE_30_DB_MAPPING.md`.
> Généré le 2026-04-26.

---

## ⚠️ Document de référence : `SLICE_30_DB_MAPPING.md`

Toutes les tables, colonnes, et règles sont dans S30. Ce doc S37 récapitule uniquement.

---

## Tables impliquées (price-preview)

| Table | Opération | Notes |
|---|---|---|
| `services` | SELECT | `service_id, coach_id, price` WHERE active=TRUE |
| `users` | SELECT (via `require_auth`) | Pour récupérer le payer_user_id |
| Tables `pricing_engine` (subscriptions, fee config, etc.) | SELECT | Documentées dans S30 et les slices `pricing_engine` antérieures |

> **AUCUNE écriture.** Endpoint 100% lecture. Pas de transaction (sauf `@Transactional(readOnly=true)` Spring optionnel pour optimisation).

---

## Comparaison avec `SLICE_30_DB_MAPPING.md`

| Aspect | Spec S30 | Code Python actuel | Divergence |
|---|---|---|---|
| Table `services` SELECT (active=TRUE) | ✅ | ✅ | — |
| Pas d'écriture | ✅ | ✅ | — |
| `@Transactional(readOnly=true)` recommandé | ✅ | ✅ (asyncpg auto-commit) | — |
| Délégation `pricing_engine` | ✅ | ✅ | — |
| Pas de lock (pas de `FOR UPDATE`) | ✅ | ✅ | — |

**Conclusion** : aucune divergence.

---

## Dépendances pricing

`pricing_engine.compute_pricing(...)` est appelé. Il consulte :
- Subscriptions actives du payer (avantages éventuels)
- Configuration des frais (fixed + percent fees côté payer + receiver)
- Currency / locale

> Ces dépendances sont **documentées dans S30** (et antérieurement dans les slices pricing_engine — voir `FINAL_RECOMMENDED_ORDER.md` si besoin).

> ⚠️ S37 ne re-documente **pas** `pricing_engine`. Si Cursor a un doute sur le moteur tarifaire, voir slices pricing dédiées.

---

## Concurrence

Aucune. Lecture pure → MVCC PostgreSQL standard.

Si un service est désactivé pendant la query (UPDATE concurrent `services SET active=FALSE`) :
- La lecture voit l'état à l'instant du snapshot.
- Si vu actif → calcul OK, response 200.
- Si vu inactif → 404.

Comportement déterministe. Pas de race condition possible.

---

## Index recommandés (déjà en S30)

```sql
-- (Probablement déjà existant)
CREATE INDEX IF NOT EXISTS idx_services_active ON services(service_id) WHERE active=TRUE;
```

> Aucune migration créée par S37.
