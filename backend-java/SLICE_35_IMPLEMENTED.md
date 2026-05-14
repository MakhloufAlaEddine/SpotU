# Slice 35 — Webhook Charge/Refund Handlers

Date: 2026-04-26

## Objectif

Porter les handlers Stripe refunds (`charge.refunded`, `refund.updated`) en Java sur l’infrastructure webhook existante (S32) et les handlers paiement déjà migrés (S33), avec parité Python stricte.

## Implémentation réalisée

### 1) Nouveau handler `ChargeEventHandler`

Fichier:
- `src/main/java/com/spotu/modules/payments/service/ChargeEventHandler.java`

Set exact géré:
- `charge.refunded`
- `refund.updated`

Comportements portés:
- `charge.refunded`
  - résolution payment (resolver S33 + fallback local par `stripe_charge_id`)
  - conversion centimes -> euros (`HALF_UP`, 2 décimales)
  - full/partial via boolean `refunded`
  - update `payments`:
    - `status` = `refunded` ou `partially_refunded`
    - `refund_amount`
    - `refund_status='succeeded'`
    - `stripe_charge_id=COALESCE(...)`
  - notif payer seulement (`payment_refunded`) si `rows_updated > 0`
  - format montant notifs/log via `Locale.ROOT`

- `refund.updated`
  - phase 1 edge case full refund (lookup par charge + tolérance `< 0.02`) + early return
  - phase 2 sync simple `refund_status` (sans notif)
  - aucun update bookings

### 2) Extension dispatcher central

Fichier:
- `src/main/java/com/spotu/modules/payments/service/StripeWebhookService.java`

Ajouts:
- branche charge activée via `ChargeEventHandler.CHARGE_EVENTS`
- propagation du `relatedId` depuis charge handler si résolu localement

### 3) Repository enrichi pour refunds

Fichier:
- `src/main/java/com/spotu/modules/payments/infra/StripeWebhookRepository.java`

Méthodes ajoutées:
- `findPaymentIdByChargeId`
- `findRefundLookupByChargeId`
- `updateRefundFromChargeRefunded`
- `findPayerUserId`
- `updateRefundAsFullyRefundedEdgeCase`
- `updateRefundStatusOnly`

## Points critiques de parité respectés

- set `_CHARGE_EVENTS` exact (2 events)
- centimes -> euros avec arrondi `HALF_UP`
- full/partial via `refunded` boolean (pas comparaison montant)
- `COALESCE(stripe_charge_id, ...)` strict
- tolérance full-refund edge case: `abs(amount-total) < 0.02` strict
- format décimal avec `Locale.ROOT` (`51.75`, pas `51,75`)
- pas d’update `bookings`
- pas de notif sur `refund.updated`
- idempotence statement-level (`rows_updated > 0` avant notif)

## Tests

Fichier modifié:
- `src/test/java/com/spotu/modules/payments/api/StripeWebhookIntegrationTest.java`

Nouveaux cas couverts:
- `charge.refunded` full
- `charge.refunded` partial
- `refund.updated` phase 1 full edge case
- `refund.updated` phase 2 sync status
- fallback payment introuvable (skip gracieux)
- idempotence event-level (duplicate `event_id`)
- non update bookings sur refund

## Validation

- `mvn -Dtest=StripeWebhookIntegrationTest test` ✅
- `mvn test` (régression complète) ✅

## Tables touchées

- `payments` (status/refund/refund_status/charge_id/updated_at)
- `notifications` (via pipeline pending notifications déjà existant)
- `stripe_webhook_events` (déjà S32, inchangé de contrat)

## Écarts restants

- Aucun écart bloquant identifié dans le périmètre S35.
- Asymétries Python conservées volontairement (notamment absence de notif sur `refund.updated`).
