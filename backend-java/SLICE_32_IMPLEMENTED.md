# Slice 32 — Webhook Stripe Infrastructure (audit parité)

Date: 2026-04-25

## Objectif

Vérifier la parité de l'infrastructure `POST /api/webhook/stripe` avec la référence Python Slice 32, corriger uniquement les écarts réels, puis valider par tests.

## Écarts réels trouvés et corrigés

1. **Codes HTTP d'erreur non conformes**
   - Avant: erreurs signature/JSON/event invalide retournaient `200 {"received":true}`.
   - Après: retour **400** avec `{"detail":"..."}` pour:
     - signature invalide (`Signature invalide : ...`)
     - JSON invalide en mode dev (`Body JSON invalide`)
     - `event_id`/`event_type` manquant (`event id/type manquant`)

2. **Vérification signature Stripe**
   - Avant: vérification HMAC manuelle.
   - Après: vérification via **Stripe SDK** `Webhook.constructEvent(...)`, conforme au comportement Python attendu (`Stripe-Signature`, timestamp tolerance Stripe, message d'erreur Stripe).

3. **Contrat endpoint**
   - `consumes` élargi à `MediaType.ALL_VALUE` pour rester robuste au payload Stripe brut tout en gardant `@RequestBody byte[]`.

4. **Logs infra Slice 32**
   - Ajout log info conforme: `Webhook reçu : type={} | id={}`.
   - Ajout debug doublon: `Webhook doublon ignoré : event_id={} type={}`.

## Conformité Slice 32 (infrastructure)

- `POST /api/webhook/stripe`: **OK**
- raw body obligatoire: **OK** (`byte[]`)
- `Stripe-Signature`: **OK** (Stripe SDK)
- idempotence `stripe_webhook_events`: **OK**
- dispatcher central: **OK**
- comportement d'erreur (handler interne => 200 + statut DB `error`): **OK**
- cycle statut `processing/success/error`: **OK**
- réponses HTTP alignées Python/doc:
  - nominal/doublon: **200**
  - signature/body/event invalide: **400**

> Note: le backend Java inclut déjà des handlers métiers (slices ultérieures). Cela reste compatible avec l'infrastructure Slice 32, qui est désormais conforme.

## Fichiers modifiés

- `src/main/java/com/spotu/modules/payments/api/StripeWebhookController.java`
- `src/main/java/com/spotu/modules/payments/service/StripeWebhookService.java`
- `src/test/java/com/spotu/modules/payments/api/StripeWebhookIntegrationTest.java`
- `KNOWN_GAPS_VS_PYTHON.md`

## Validation tests

- Ciblé webhook: `mvn -Dtest=StripeWebhookIntegrationTest test` ✅
- Régression complète backend-java: `mvn test` ✅

