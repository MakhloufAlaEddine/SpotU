# Slice 21 — Abonnements utilisateur (Stripe Subscriptions)

Implémenté le **2026-04-13**. Alignement sur `subscription_routes.py` (endpoints utilisateur) et `stripe_service.py` (customer, price, checkout subscription, cancel, retrieve session), cohérent avec la **slice 20** (webhooks abonnements).

## Endpoints livrés

| Méthode | Chemin | Auth |
|---------|--------|------|
| GET | `/api/subscription-plans` | aucune (public) |
| POST | `/api/subscriptions/subscribe` | stricte (`AuthMeService`) |
| GET | `/api/subscriptions/checkout/status/{sessionId}` | stricte |
| GET | `/api/subscriptions/me` | stricte |
| GET | `/api/subscriptions/history` | stricte |
| POST | `/api/subscriptions/cancel` | stricte |

## Fichiers principaux

- `com.spotu.modules.subscriptions.api.SubscriptionController`
- `com.spotu.modules.subscriptions.service.SubscriptionService`
- `com.spotu.modules.subscriptions.infra.SubscriptionJdbcRepository`
- `com.spotu.modules.subscriptions.dto.SubscribeRequest`
- `com.spotu.modules.payments.stripe.StripeSubscriptionService`

## Tables touchées

- `subscription_plans` : SELECT (public + chargement plan), UPDATE `stripe_product_id` / `stripe_price_id` après création Stripe.
- `users` : UPDATE `stripe_customer_id` si NULL.
- `user_subscriptions` : SELECT (garde subscribe, /me, /history, cancel, lookup par `stripe_subscription_id`), UPDATE statut + `cancelled_at` sur cancel.

## Intégrations Stripe

1. `Customer.search` + `Customer.create` (metadata `user_id`) — `getOrCreateCustomer`.
2. `Product.search` / `Product.create` + `Price.list` / `Price.create` — `ensureSubscriptionPrice` (idempotent si `stripe_price_id` déjà en base).
3. `Session.create` mode subscription + idempotency `sub_cs_{user_id}_{plan_id}_{bucket5min}` — `createSubscriptionCheckoutSession`.
4. `Session.retrieve` — `retrieveCheckoutSession`.
5. `Subscription.update(cancel_at_period_end)` ou `Subscription.cancel` — `cancelStripeSubscription`.

## Tests

- `SubscriptionIntegrationTest` : plans publics, subscribe (401/404/400/409, past_due autorisé, nominal + idempotence), /me sans abo + avec snapshot JSON, /history, checkout status (403, admin, 404 Stripe, 200 + local), cancel (403 immediate, 404, JSON invalide, Stripe KO, sans `stripe_subscription_id`).
- Données H2 : `test-data-users.sql` — plans `plan_s21_*` en plus de `plan_webhook_sub` (slice 20).

## Écarts / notes

- **Devise** : `ensureSubscriptionPrice` utilise `EUR` côté Java si la colonne `currency` n’est pas lue en base (équivalent Python `plan.get("currency", "EUR")` sans colonne dédiée dans le SELECT `findPlanById`).
- **stripe-java 28** : `Session.getCustomer()` / `getSubscription()` exposent des **String** (ids) en non-expandé ; le service les traite comme telles.
- **POST /cancel** : corps JSON invalide est avalé comme en Python (`try/except` → `{}`) en lisant le flux brut (pas de `@RequestBody` JSON automatique sur cet endpoint).
- **GET /me** : réponse sans abonnement utilise une `LinkedHashMap` (pas `Map.of`) car **`subscription: null`** est requis.

## Hors périmètre (inchangé)

- Endpoints **admin** abonnements / plans (`/api/admin/subscription-plans`, etc.) — slice future (ex. S22).
- Webhooks : restent dans la slice 20.
