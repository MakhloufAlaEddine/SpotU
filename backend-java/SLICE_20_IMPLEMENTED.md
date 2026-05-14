# Slice 20 — Webhook Stripe abonnements (extension slice 16)

## Objectif

Étendre `POST /api/webhook/stripe` pour traiter les **événements Stripe abonnements** comme en Python (`webhook_handlers.py:_handle_subscription_event` actif), **sans** porter le handler dupliqué `subscription_routes.py`.

## Event types gérés

| Event Stripe | Comportement (fidèle Python) |
|--------------|------------------------------|
| `checkout.session.completed` | Si `mode=subscription` : INSERT `user_subscriptions`, `benefits_snapshot`, `retrieveSubscription` pour `expires_at` (try/catch → `null` si échec), notification `subscription_activated`. Sinon ignoré ici (paiement slice 16). |
| `customer.subscription.created` | INSERT si metadata `plan_id`+`user_id` et pas déjà de ligne pour `stripe_subscription_id` ; `expires_at` depuis `current_period_end` ; notification. |
| `customer.subscription.updated` | Mapping statut Stripe + `cancel_at_period_end` ; UPDATE avec garde `status NOT IN ('cancelled')` ; deux SQL selon présence de `expires_at` ; notifs seulement si `rows > 0` et statut `cancelling` ou `cancelled`. |
| `customer.subscription.deleted` | `user_id` lu **avant** UPDATE ; UPDATE `cancelled` + `cancelled_at` **sans** garde `NOT IN ('cancelled')` ; notif si `rows > 0`. |
| `invoice.paid` | Extraction `lines.data[0].period.end` ; UPDATE `expires_at` + `status='active'` avec garde `NOT IN ('cancelled')` ; notif `subscription_renewed` si `rows > 0`. |
| `invoice.payment_failed` | UPDATE `past_due` avec garde ; notif si `rows > 0`. |

## Composants créés / modifiés

| Fichier | Rôle |
|---------|------|
| `modules/payments/subscription/SubscriptionWebhookHandler.java` | Routage par `event_type`, logique métier + collecte `PendingWebhookNotification` |
| `modules/payments/subscription/PendingWebhookNotification.java` | DTO file d’attente notifications |
| `modules/payments/infra/SubscriptionWebhookRepository.java` | SQL JDBC (plans, `user_subscriptions`, INSERT notifications) |
| `modules/payments/service/StripeWebhookService.java` | Après handlers paiement : appel subscription, fusion `related_id`, `markDone` puis persistance notifications |
| `modules/payments/stripe/StripePaymentService.java` | `retrieveSubscription(String)` pour checkout subscription |
| `test-schema-users.sql` / `test-data-users.sql` | Tables + plan de test `plan_webhook_sub` |
| `StripeWebhookIntegrationTest.java` | Cas nominal, dual routing, `deleted` sans garde, `invoice.paid`, `subscription.updated` |

## Dual routing `checkout.session.completed`

1. Résolution `payment_id` / `booking_id` (inchangé slice 16).  
2. `handleCheckoutCompleted` : retour immédiat si `mode=subscription` (pas de mutation paiement).  
3. `SubscriptionWebhookHandler` : si `mode≠subscription` sur checkout, branche subscription no-op ; si `mode=subscription`, traitement abonnement.

## Tables touchées

- `subscription_plans` (SELECT)
- `user_subscriptions` (INSERT / UPDATE)
- `stripe_webhook_events` (inchangé : `related_id` = `subscription_id` interne quand applicable)
- `notifications` (INSERT pour les events subscription documentés)

## Tests

- `mvn test` : non-régression globale + nouveaux scénarios webhook (voir `StripeWebhookIntegrationTest`).

## Hors périmètre (documenté)

- Endpoints utilisateur `/subscribe`, `/subscriptions/me`, cancel côté API, admin plans, `ensure_subscription_price`, etc.
- Handler legacy `subscription_routes.py:handle_subscription_event` : **non migré**.
- Événements charge (`charge.refunded`, …) : inchangés côté Java si non couverts ailleurs.

## Validation

- `mvn test` sur `backend-java`.

## Ambiguïté / divergence mineure

- Python envoie les notifications **après** la libération de la connexion pool, y compris si une erreur survient après les handlers dans certains chemins rares ; Java n’envoie les notifications **qu’après** `markDone(..., success)` dans le même `try` — alignement pragmatique sur le chemin nominal succès.
