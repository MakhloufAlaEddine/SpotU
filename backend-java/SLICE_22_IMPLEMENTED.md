# Slice 22 — Admin subscriptions / plans

Implémenté le **2026-04-13**. Alignement sur `admin_routes.py:208–283` (CRUD plans) et `subscription_routes.py:453–511` (liste + cancel admin), cohérent avec les slices **19–21**.

## Endpoints (un seul `GET` plans admin — canonique)

| Méthode | Chemin | Source Python |
|---------|--------|-----------------|
| GET | `/api/admin/subscription-plans` | `admin_routes.py:210` (handler effectif documenté ; doublon `subscription_routes.py:151` **non** reproduit) |
| POST | `/api/admin/subscription-plans` | `admin_routes.py:221` |
| PUT | `/api/admin/subscription-plans/{planId}` | `admin_routes.py:252` |
| DELETE | `/api/admin/subscription-plans/{planId}` | `admin_routes.py:277` |
| GET | `/api/admin/subscriptions` | `subscription_routes.py:453` |
| POST | `/api/admin/subscriptions/{subscriptionId}/cancel` | `subscription_routes.py:472` |

### Choix « un seul GET plans »

En FastAPI, `GET /api/admin/subscription-plans` est enregistré deux fois (`server.py` : `admin_routes` puis `subscription_routes`). Le comportement retenu côté Java est celui d’**`admin_routes.py`** : `SELECT` de toutes les colonnes utiles (équivalent `SELECT *`), `ORDER BY priority DESC, created_at` (tri asc implicite sur `created_at`).

## Fichiers

- `com.spotu.modules.subscriptions.api.AdminSubscriptionController`
- `com.spotu.modules.subscriptions.service.AdminPlanService`
- `com.spotu.modules.subscriptions.service.SubscriptionService` — `listSubscriptionsForAdmin`, `adminCancelSubscription`
- `com.spotu.modules.subscriptions.infra.SubscriptionJdbcRepository` — requêtes admin
- `com.spotu.modules.auth.service.AuthMeService` — `requireAdmin` (`403` + message `Requires admin role`, aligné `auth_utils.require_role`)

## Tables

- `subscription_plans` : SELECT (liste admin), INSERT (create), UPDATE dynamique (allowed fields), DELETE.
- `user_subscriptions` : SELECT (liste admin + cancel), UPDATE (cancel admin).
- `users`, `subscription_plans` : LEFT JOIN pour la liste admin.

## Stripe

- **Aucun** appel Stripe sur CRUD plans (comme Python).
- **Cancel admin** : `StripeSubscriptionService.cancelStripeSubscription` si `stripe_subscription_id` non vide ; erreur avalée (`log.error`) puis **UPDATE DB** (ordre Stripe → DB, comme S21 user cancel).

## Id `plan_*` à la création

Équivalent `new_id("plan")` : `plan_` + 12 caractères hex (`UUID`).

## Écarts assumés vs Python

| Sujet | Python | Java |
|-------|--------|------|
| DELETE plan avec abonnements liés | FK non gérée → souvent **500** | **`409`** + message explicite (`ApiConflictException` / `DataIntegrityViolationException`) |
| DELETE plan inexistant | `200 {success:true}` | identique (`DELETE` 0 ligne) |
| PUT plan | pas de sync Stripe | identique (documenté BR-05 côté Python) |

## Tests H2

- Contrainte `FOREIGN KEY (plan_id)` déclarée **inline** dans `CREATE TABLE user_subscriptions` (évite une réexécution `ALTER` lorsque `CREATE IF NOT EXISTS` est ignorée sur ré-init script).
- `AdminSubscriptionIntegrationTest` : 403 non-admin, liste plans, create 400/200, update 404/400/200, delete absent 200, delete avec FK 409, liste subscriptions, cancel 404/nominal (corps sans `subscription_id`).

## Hors périmètre

- Autres routes `admin_routes` (domains, tags-analytics, etc.).
- Sync Stripe automatique après changement de prix / durée (inchangé : hors scope Python).
