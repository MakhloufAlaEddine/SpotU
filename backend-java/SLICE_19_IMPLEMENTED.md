# Slice 19 — `StripePaymentService` (SDK Stripe réel)

## Objectif

Remplacer les **stubs réseau** utilisés dans les slices booking **12 / 13 / 15 / 18** par un composant central aligné sur `stripe_service.py` (capture, annulation PaymentIntent, remboursement charge), **sans accès DB**, **sans `@Transactional`**, erreurs **avalées** par les callers après commit (comme en Python).

## Composants créés ou modifiés

| Fichier | Rôle |
|---------|------|
| `config/StripeSdkBootstrap.java` | `@PostConstruct` : `Stripe.apiKey`, `stripe.api-base-override` ou détection `sk_test_emergent` → proxy Emergent |
| `modules/payments/stripe/StripePaymentService.java` | `capturePaymentIntent`, `cancelPaymentIntent` (mapping raisons métier → Stripe), `createRefund` (raisons validées + idempotency `rf_{key}`), `retrievePaymentIntent` |
| `modules/bookings/service/BookingWriteService.java` | Branchement réel : refuse / accept cas A / cancel |
| `modules/workers/service/ExpiryWorkerService.java` | Annulation PI expiration via `StripePaymentService` |
| `pom.xml` | Dépendance `com.stripe:stripe-java` |
| `src/main/resources/application.yml` | `stripe.api-key`, `stripe.api-base-override` |

## Stubs retirés

- Logs du type `[STUB] Stripe …` dans **refuse**, **accept (capture)**, **cancel** (cancel PI + refund), **ExpiryWorker** (cancel PI).
- Classe **`ExpiryStripeService`** supprimée ; le worker réutilise le même `StripePaymentService` que le module bookings.

## Flows branchés sur le vrai service

| Slice | Endpoint / worker | Appel Stripe |
|-------|-------------------|--------------|
| 12 | `POST …/refuse` | `cancelPaymentIntent(pi, "refused")` → raison Stripe `abandoned` |
| 13 | `POST …/accept` (cas A `authorized`) | `capturePaymentIntent(pi)` |
| 15 | `POST …/cancel` | `cancelPaymentIntent(pi, "cancelled")` si paiement pré-capture ; `createRefund(chargeId, null, "requested_by_customer", bookingId)` si post-capture avec `charge_id` |
| 18 | `ExpiryWorkerService` | `cancelPaymentIntent(pi, "expired")` |

Ordre conservé : **transaction DB puis appel Stripe** (hors transaction), `try/catch` avec `log.error` côté caller.

## Tests

- `modules/payments/stripe/StripePaymentServiceMappingTest.java` : mappings cancel/refund (fidèle `_CANCEL_REASONS` / `_REFUND_REASONS`).
- `BookingCancelIntegrationTest` : `@MockBean StripePaymentService` pour simuler succès réseau sans clé API (comportement identique à Python quand Stripe répond OK ; si Stripe échoue, `stripe_action` reste `null` comme en Python).
- `ExpiryWorkerServiceIntegrationTest` : mock `StripePaymentService` (signatures avec `throws StripeException` pour Mockito).

## Non couvert par cette slice (reste non prod-ready côté Stripe si besoin)

- **Abonnements** Stripe (hors scope utilisateur).
- **`StripePaymentService.retrievePaymentIntent`** : exposé pour parité Python ; pas encore branché sur un endpoint Java équivalent à `payment_routes` si absent.
- **Admin payments complet** : inchangé.
- Sans **`STRIPE_API_KEY`** : warning au boot ; les appels réseau échouent (les callers avalent l’erreur).

## Validation

- `mvn test` sur le module `backend-java`.
