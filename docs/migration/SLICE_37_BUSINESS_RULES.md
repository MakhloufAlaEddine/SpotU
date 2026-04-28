# SLICE_37_BUSINESS_RULES.md — Audit price-preview (no-op)
> Basé sur `routes/booking_routes.py:115–158`, `SLICE_30_BUSINESS_RULES.md`.
> Généré le 2026-04-26.

---

## ⚠️ Document de référence : `SLICE_30_BUSINESS_RULES.md`

S37 ne redéfinit aucune règle. Il vérifie uniquement.

---

## Règles applicables à price-preview (compat S30)

| BR S30 | Règle | Statut |
|---|---|---|
| Auth obligatoire (compat S34/BR-34.01) | OUI | Vérifié |
| `service_id` requis (400 sinon) | OUI | Vérifié |
| Service doit être `active=TRUE` (404 sinon) | OUI | Vérifié |
| `payer_user_id` = user authentifié (jamais le frontend qui le passe) | OUI | Vérifié — sécurité critique |
| `receiver_user_id` = `services.coach_id` (déduit du service, pas du body) | OUI | Vérifié |
| `currency` hardcodée `'EUR'` | OUI | Vérifié |
| `product_type` hardcodé `'service_booking'` | OUI | Vérifié |
| `base_amount` = `services.price` (cast float) | OUI | Vérifié |
| Délégation calcul à `pricing_engine` | OUI | Vérifié |

---

## Flags `app_config` éventuels

> ⚠️ **Note importante** : le price-preview **ne consulte PAS** les flags `app_config` (`enable_manual_approval_for_services`, `enable_pay_later_for_services`). Ces flags sont consultés par `POST /bookings/request` (lignes 200–205) mais **pas** par price-preview.

**Compat stricte** : Java doit reproduire cette asymétrie. Le price-preview retourne le tarif **sans** filtre flags. Si l'admin désactive `manual_approval` après que le buyer a fait un price-preview, le price-preview reste valide ; seul `request` rejettera.

---

## Validations

| Validation | Présent dans Python | Java doit reproduire |
|---|---|---|
| `service_id` non vide | OUI (`if not service_id`) | ✅ |
| Service `active=TRUE` | OUI (clause WHERE) | ✅ |
| `coach_id` non null (FK) | Implicite via FK DB | ✅ |
| `price` > 0 | **NON** (pas de check applicatif) | ✅ ne pas ajouter |
| Currency whitelisting | **NON** (toujours EUR) | ✅ |

> ⚠️ Si un service a `price=0` ou `price<0` en DB, le pricing_engine est appelé avec ces valeurs. Pas de garde-fou applicatif. **Reproduire** ce comportement (compat stricte).

---

## Écarts éventuels vs S30

**AUCUN.** Toutes les règles documentées en S30 sont toujours appliquées par le code Python actuel (vérifié 2026-04-26).

---

## Asymétries à préserver

| Aspect | Comportement | Java doit reproduire |
|---|---|---|
| Pas de consultation `app_config` (vs `request`) | OUI | ✅ |
| Pas de check `price >= 0` | OUI | ✅ |
| Pas de slot validation (ce n'est qu'un preview) | OUI | ✅ |
| Currency hardcodée EUR | OUI | ✅ |
| `payer_user_id` jamais accepté du body | OUI (sécurité) | ✅ |

---

## Limitations connues

| Limitation | Reproduire ? |
|---|---|
| Pas de cache du résultat (recalcule à chaque appel) | OUI |
| Pas de rate limiting visible | OUI (sauf si gateway) |
| Le tarif peut changer entre price-preview et request réel (ex: subscription expirée entre les 2 calls) | OUI (acceptable, c'est un preview indicatif) |
| Pas d'ID unique de preview (impossible de "réserver" un tarif) | OUI |
