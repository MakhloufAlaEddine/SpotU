# Slice 37 — Price Preview (Audit no-op)

Date: 2026-04-28

## Objectif

Confirmer que `POST /api/bookings/price-preview` est déjà couvert par la Slice 30, sans recoder l’endpoint.

## Verdict

- **Conforme: OUI**
- L’implémentation Java actuelle de S30 respecte le contrat Python/S30:
  - auth obligatoire
  - `service_id` requis (400)
  - service actif requis (404 sinon)
  - calcul via `pricing_engine`
  - projection de réponse attendue (montants + `currency`)

## Actions réalisées

- **Aucun changement de code applicatif** (`controller/service/repository` inchangés).
- Ajout d’un seul test de régression S37 dans:
  - `src/test/java/com/spotu/modules/bookings/api/BookingBuyerIntegrationTest.java`

Test ajouté:
- `pricePreview_ignoresAppConfigFlags_andKeepsExactProjection`
  - vérifie que `price-preview` ne dépend pas des flags `app_config` (`manual_approval` / `pay_later`)
  - vérifie la présence des 9 champs attendus et l’absence de champs hors scope (`service_id`, `status`, `payment_mode`)

## Validation

- `mvn -Dtest=BookingBuyerIntegrationTest test` ✅

## Résumé demandé

- **conforme oui/non**: **oui**
- **tests ajoutés ou non**: **oui** (1 test de régression ciblé)
- **prochaine vraie slice recommandée**: **S38** (booking cancel), car c’est la prochaine brique métier utile du parcours buyer.
