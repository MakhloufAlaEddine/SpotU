# ENDPOINTS_CANONICAL_LIST.md
Source : AST statique sur `backend/server.py` (`api_router`) et `backend/routes/*.py`, montages `include_router` de `server.py` (lignes 93–112). **Aucune exécution** de l’application (import `server` impossible ici sans répertoire `/app/backend/uploads` attendu par `upload_routes.py`).
Légende **exposé** : `oui` = route enregistrée via décorateur FastAPI ; `incertain` = dépend d’un runtime non vérifié dans cette passe.
Légende **auth** : suffixe `(certain)` / `(déduit)` / `(incertain)` selon classification automatique (corps du handler).

| Méthode | Path | Fichier | Handler | Exposé | Type | Auth | Alias / double déco | Collision | Notes migration |
|---------|------|---------|---------|--------|------|------|---------------------|-----------|------------------|
| GET | `/api/addresses` | `address_routes.py` | `list_addresses` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/addresses` | `address_routes.py` | `create_address` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| DELETE | `/api/addresses/{address_id}` | `address_routes.py` | `delete_address` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| PUT | `/api/addresses/{address_id}` | `address_routes.py` | `update_address` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/admin/all-categories` | `admin_routes.py` | `admin_all_categories` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/all-domains` | `admin_routes.py` | `admin_all_domains` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/all-tags` | `admin_routes.py` | `admin_all_tags` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/app-config` | `admin_routes.py` | `get_app_config` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/admin/app-config` | `admin_routes.py` | `update_app_config` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/domains` | `admin_routes.py` | `admin_domains` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/payments` | `payment_routes.py` | `admin_list_payments` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/payments/stats` | `payment_routes.py` | `admin_payment_stats` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/pricing-rules` | `admin_routes.py` | `list_pricing_rules` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| POST | `/api/admin/pricing-rules` | `admin_routes.py` | `create_pricing_rule` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| DELETE | `/api/admin/pricing-rules/{rule_id}` | `admin_routes.py` | `delete_pricing_rule` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/admin/pricing-rules/{rule_id}` | `admin_routes.py` | `update_pricing_rule` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/products/pending` | `admin_product_routes.py` | `list_pending_products` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/admin/products/{product_id}` | `admin_product_routes.py` | `get_product_for_review` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/admin/products/{product_id}/approve` | `admin_product_routes.py` | `approve_product` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/admin/products/{product_id}/reject` | `admin_product_routes.py` | `reject_product` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/admin/purge` | `admin_routes.py` | `trigger_purge` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/purge/status` | `admin_routes.py` | `purge_status` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/services` | `admin_routes.py` | `admin_services` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/stats` | `admin_routes.py` | `get_stats` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/subscription-plans` | `admin_routes.py` | `list_subscription_plans` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | Oui : `admin_routes.py` `list_subscription_plans` ; `subscription_routes.py` `admin_list_plans` | Starlette résout en **premier enregistré** selon l’ordre d’`include_router` dans `server.py` — **gagnant déduit** : `admin_routes.py` → `list_subscription_plans` (voir `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`). Handler(s) en conflit potentiellement **jamais atteints** (même méthode+path). |
| POST | `/api/admin/subscription-plans` | `admin_routes.py` | `create_subscription_plan` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| DELETE | `/api/admin/subscription-plans/{plan_id}` | `admin_routes.py` | `delete_subscription_plan` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/admin/subscription-plans/{plan_id}` | `admin_routes.py` | `update_subscription_plan` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/subscriptions` | `payment_routes.py` | `admin_subscriptions` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | Oui : `payment_routes.py` `admin_subscriptions` ; `subscription_routes.py` `admin_list_subscriptions` | Starlette résout en **premier enregistré** selon l’ordre d’`include_router` dans `server.py` — **gagnant déduit** : `payment_routes.py` → `admin_subscriptions` (voir `ROUTE_COLLISIONS_AND_AMBIGUITIES.md`). Handler(s) en conflit potentiellement **jamais atteints** (même méthode+path). |
| POST | `/api/admin/subscriptions/{subscription_id}/cancel` | `subscription_routes.py` | `admin_cancel_subscription` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/tag-points` | `admin_routes.py` | `admin_tag_points` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| DELETE | `/api/admin/tag-points/{point_id}` | `admin_routes.py` | `admin_delete_tag_point` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/tags-analytics` | `admin_routes.py` | `get_tags_analytics` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/admin/users` | `admin_routes.py` | `list_users` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/admin/users/{user_id}/role` | `admin_routes.py` | `set_user_role` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/admin/users/{user_id}/verify-coach` | `admin_routes.py` | `verify_coach` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/auth/change-password` | `auth_routes.py` | `change_password` | oui | HTTP | Bearer JWT (certain) | — | — | — |
| POST | `/api/auth/google` | `auth_routes.py` | `google_auth` | oui | HTTP | Public + rate-limit (certain) | — | — | — |
| POST | `/api/auth/login` | `auth_routes.py` | `login` | oui | HTTP | Public + rate-limit (certain) | — | — | — |
| POST | `/api/auth/logout` | `auth_routes.py` | `logout` | oui | HTTP | Bearer JWT (certain) | — | — | — |
| GET | `/api/auth/me` | `auth_routes.py` | `get_me` | oui | HTTP | Bearer JWT (certain) | — | — | — |
| GET | `/api/auth/native-callback` | `auth_routes.py` | `native_google_callback` | oui | HTTP | Public (redirect OAuth) (certain) | — | — | — |
| POST | `/api/auth/register` | `auth_routes.py` | `register` | oui | HTTP | Public + rate-limit (certain) | — | — | — |
| POST | `/api/bookings` | `booking_routes.py` | `create_booking` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/bookings/me` | `booking_routes.py` | `my_bookings` | oui | HTTP | Bearer JWT (require_auth) (certain) | Alias URL : même handler, chemins distincts [('GET', '/api/bookings/me'), ('GET', '/api/users/me/bookings')] | — | — |
| POST | `/api/bookings/price-preview` | `booking_routes.py` | `booking_price_preview` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/bookings/received` | `booking_routes.py` | `received_bookings` | oui | HTTP | Bearer JWT (require_auth) (certain) | Alias URL : même handler, chemins distincts [('GET', '/api/bookings/received'), ('GET', '/api/receiver/requests')] | — | — |
| POST | `/api/bookings/request` | `booking_routes.py` | `request_booking` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/bookings/{booking_id}` | `booking_routes.py` | `get_booking_detail` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/bookings/{booking_id}/accept` | `booking_routes.py` | `accept_booking` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/bookings/{booking_id}/cancel` | `booking_routes.py` | `cancel_booking` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/bookings/{booking_id}/pay` | `booking_routes.py` | `pay_booking` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/bookings/{booking_id}/refuse` | `booking_routes.py` | `refuse_booking` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/bookings/{booking_id}/status` | `booking_routes.py` | `update_booking_status` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/config/booking` | `server.py` | `public_booking_config` | oui | HTTP | Public (certain) | — | — | — |
| GET | `/api/config/commission` | `server.py` | `public_commission_config` | oui | HTTP | Public (certain) | — | — | — |
| GET | `/api/conversations` | `chat_routes.py` | `list_conversations` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/conversations` | `chat_routes.py` | `create_or_get_conversation` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/conversations/{conv_id}/leave` | `deletion_routes.py` | `leave_conversation` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/conversations/{conv_id}/messages` | `chat_routes.py` | `get_messages` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PUT | `/api/conversations/{conv_id}/read` | `chat_routes.py` | `mark_read` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/domains` | `domain_routes.py` | `get_domains` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/domains` | `domain_routes.py` | `create_domain` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| DELETE | `/api/domains/{domain_id}` | `domain_routes.py` | `delete_domain` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/domains/{domain_id}` | `domain_routes.py` | `update_domain` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/domains/{domain_id}/usage` | `domain_routes.py` | `get_domain_usage` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/home/feed` | `home_routes.py` | `home_feed` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/home/nearest-sector` | `home_routes.py` | `nearest_sector` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/liveness` | `server.py` | `liveness` | oui | HTTP | Public (certain) | — | — | — |
| GET | `/api/marketplace/products` | `marketplace_routes.py` | `get_marketplace_products` | oui | HTTP | Public (probable) (incertain) | — | — | — |
| DELETE | `/api/messages/{message_id}` | `deletion_routes.py` | `delete_message` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/payments/checkout/session` | `payment_routes.py` | `create_checkout_session` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/payments/checkout/status/{session_id}` | `payment_routes.py` | `get_checkout_status` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/payments/me` | `payment_routes.py` | `my_payments` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/payments/{payment_id}` | `payment_routes.py` | `get_payment` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/payments/{payment_id}/stripe` | `payment_routes.py` | `update_stripe_fields` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/products` | `product_creation_routes.py` | `create_product` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/products/mine` | `product_creation_routes.py` | `get_my_products` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/products/{product_id}` | `product_creation_routes.py` | `delete_product` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/products/{product_id}/detail` | `product_creation_routes.py` | `get_product_detail` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/products/{product_id}/reactivate` | `product_creation_routes.py` | `reactivate_product` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/readiness` | `server.py` | `readiness` | oui | HTTP | Public (certain) | — | — | — |
| GET | `/api/receiver/requests` | `booking_routes.py` | `received_bookings` | oui | HTTP | Bearer JWT (require_auth) (certain) | Alias URL : même handler, chemins distincts [('GET', '/api/bookings/received'), ('GET', '/api/receiver/requests')] | — | — |
| GET | `/api/services` | `service_routes.py` | `search_services` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/services` | `service_routes.py` | `create_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/services/deactivated` | `service_routes.py` | `get_deactivated_services` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/services/mine` | `service_routes.py` | `my_services` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/services/saved` | `service_routes.py` | `get_saved_services` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/services/{service_id}` | `service_routes.py` | `delete_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/services/{service_id}` | `service_routes.py` | `get_service` | oui | HTTP | JWT optionnel (déduit) | — | — | — |
| PATCH | `/api/services/{service_id}` | `service_routes.py` | `update_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | Double décorateur : même handler, **PUT + PATCH** sur le **même** path (deux opérations HTTP distinctes, pas des alias d’URL) | — | — |
| PUT | `/api/services/{service_id}` | `service_routes.py` | `update_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | Double décorateur : même handler, **PUT + PATCH** sur le **même** path (deux opérations HTTP distinctes, pas des alias d’URL) | — | — |
| POST | `/api/services/{service_id}/reactivate` | `service_routes.py` | `reactivate_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/services/{service_id}/save` | `service_routes.py` | `save_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/services/{service_id}/unsave` | `service_routes.py` | `unsave_service` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/spot-you/my-completion-stats` | `spot_you_routes.py` | `my_completion_stats` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/spot-you/{point_id}/activity` | `spot_you_routes.py` | `get_spot_you_activity` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| DELETE | `/api/spot-you/{point_id}/going` | `spot_you_routes.py` | `not_going_spot_you` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/spot-you/{point_id}/going` | `spot_you_routes.py` | `get_spot_you_going` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/spot-you/{point_id}/going` | `spot_you_routes.py` | `going_spot_you` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/spot-you/{point_id}/join` | `spot_you_routes.py` | `join_spot_you` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/spot-you/{point_id}/leave` | `spot_you_routes.py` | `leave_spot_you` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/subscription-plans` | `subscription_routes.py` | `list_subscription_plans` | oui | HTTP | Public (docstring module subscription) (déduit) | — | — | — |
| POST | `/api/subscriptions/cancel` | `subscription_routes.py` | `cancel_subscription` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/subscriptions/checkout/status/{session_id}` | `subscription_routes.py` | `get_subscription_checkout_status` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/subscriptions/history` | `subscription_routes.py` | `get_subscription_history` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/subscriptions/me` | `subscription_routes.py` | `get_my_subscription` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/subscriptions/subscribe` | `subscription_routes.py` | `subscribe` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points` | `tagpoint_routes.py` | `search_tag_points` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/tag-points` | `tagpoint_routes.py` | `create_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/mine` | `tagpoint_routes.py` | `my_tag_points` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/saved` | `tagpoint_routes.py` | `get_saved_tag_points` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/tag-points/{point_id}` | `deletion_routes.py` | `delete_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/{point_id}` | `tagpoint_routes.py` | `get_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PUT | `/api/tag-points/{point_id}` | `tagpoint_routes.py` | `update_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/tag-points/{point_id}/cancel-request` | `tagpoint_routes.py` | `cancel_join_request` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/invitations/accept` | `tagpoint_routes.py` | `accept_invitation` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/invitations/refuse` | `tagpoint_routes.py` | `refuse_invitation` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/invite` | `tagpoint_routes.py` | `invite_user_to_spotyou` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/join` | `tagpoint_routes.py` | `join_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/{point_id}/join-requests` | `tagpoint_routes.py` | `get_join_requests` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/tag-points/{point_id}/leave` | `tagpoint_routes.py` | `leave_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/members/{member_id}/approve` | `tagpoint_routes.py` | `approve_join_request` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/members/{member_id}/reject` | `tagpoint_routes.py` | `reject_join_request` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/{point_id}/my-vote` | `tagpoint_routes.py` | `get_my_vote` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/tag-points/{point_id}/new-date` | `tagpoint_routes.py` | `toggle_new_date_coming` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/{point_id}/participants` | `tagpoint_routes.py` | `get_tag_point_participants` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/tag-points/{point_id}/reactivate` | `deletion_routes.py` | `reactivate_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/save` | `tagpoint_routes.py` | `save_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/{point_id}/similar` | `tagpoint_routes.py` | `get_similar_tag_points` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| DELETE | `/api/tag-points/{point_id}/unsave` | `tagpoint_routes.py` | `unsave_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/tag-points/{point_id}/vote` | `tagpoint_routes.py` | `vote_tag_point` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/tag-points/{point_id}/votes` | `tagpoint_routes.py` | `get_tag_point_votes` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| GET | `/api/tags` | `domain_routes.py` | `get_tags` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/tags` | `domain_routes.py` | `create_tag` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/tags/categories` | `domain_routes.py` | `get_categories` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/tags/categories` | `domain_routes.py` | `create_category` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| DELETE | `/api/tags/categories/{category_id}` | `domain_routes.py` | `delete_category` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/tags/categories/{category_id}` | `domain_routes.py` | `update_category` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/tags/categories/{category_id}/usage` | `domain_routes.py` | `get_category_usage` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| DELETE | `/api/tags/{tag_id}` | `domain_routes.py` | `delete_tag` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| PUT | `/api/tags/{tag_id}` | `domain_routes.py` | `update_tag` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| GET | `/api/tags/{tag_id}/usage` | `domain_routes.py` | `get_tag_usage` | oui | HTTP | Admin JWT (require_role admin) (certain) | — | — | — |
| POST | `/api/upload-image` | `upload_routes.py` | `upload_image` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/upload-image/debug-422` | `upload_routes.py` | `debug_upload` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/users/become-coach` | `user_routes.py` | `become_coach` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/activity-feed` | `user_routes.py` | `get_activity_feed` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/bookings` | `booking_routes.py` | `my_bookings` | oui | HTTP | Bearer JWT (require_auth) (certain) | Alias URL : même handler, chemins distincts [('GET', '/api/bookings/me'), ('GET', '/api/users/me/bookings')] | — | — |
| GET | `/api/users/me/events` | `tagpoint_routes.py` | `get_my_events` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/notifications` | `tagpoint_routes.py` | `get_my_notifications` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/users/me/notifications/read-all` | `tagpoint_routes.py` | `mark_all_notifications_read` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/users/me/notifications/{notif_id}/read` | `tagpoint_routes.py` | `mark_notification_read` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/pending-requests` | `tagpoint_routes.py` | `get_my_pending_requests` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/planning-events` | `tagpoint_routes.py` | `get_planning_events` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/reactivatable` | `deletion_routes.py` | `get_reactivatable` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/me/spotyou-invitations` | `tagpoint_routes.py` | `get_my_invitations` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/profile` | `user_routes.py` | `get_profile` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PUT | `/api/users/profile` | `user_routes.py` | `update_profile` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/users/push-token` | `push_routes.py` | `unregister_push_token` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/users/push-token` | `push_routes.py` | `register_push_token` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/search` | `user_routes.py` | `search_users` | oui | HTTP | JWT optionnel (déduit) | — | — | — |
| DELETE | `/api/users/{user_id}` | `deletion_routes.py` | `delete_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/users/{user_id}/block` | `user_routes.py` | `unblock_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/users/{user_id}/block` | `user_routes.py` | `block_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/users/{user_id}/cover` | `user_routes.py` | `update_cover` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PATCH | `/api/users/{user_id}/deactivate` | `deletion_routes.py` | `deactivate_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| DELETE | `/api/users/{user_id}/follow` | `user_routes.py` | `unfollow_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/users/{user_id}/follow` | `user_routes.py` | `follow_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/{user_id}/followers` | `user_routes.py` | `list_followers` | oui | HTTP | JWT optionnel (déduit) | — | — | — |
| DELETE | `/api/users/{user_id}/followers/{follower_id}` | `user_routes.py` | `remove_follower` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/{user_id}/following` | `user_routes.py` | `list_following` | oui | HTTP | JWT optionnel (déduit) | — | — | — |
| GET | `/api/users/{user_id}/public` | `user_routes.py` | `get_public_profile` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/users/{user_id}/reactivate` | `deletion_routes.py` | `reactivate_user` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/{user_id}/reviews` | `user_routes.py` | `get_user_reviews` | oui | HTTP | Non classifié automatiquement — relire le handler (incertain) | — | — | — |
| POST | `/api/users/{user_id}/reviews` | `user_routes.py` | `create_user_review` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| PUT | `/api/users/{user_id}/reviews/{review_id}` | `user_routes.py` | `update_user_review` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| GET | `/api/users/{user_id}/suggestions` | `user_routes.py` | `suggest_follows` | oui | HTTP | Bearer JWT (require_auth) (certain) | — | — | — |
| POST | `/api/webhook/stripe` | `payment_routes.py` | `stripe_webhook` | oui | HTTP | Signature Stripe (pas JWT utilisateur) (certain) | — | — | — |
| WS | `/api/ws/chat/{conv_id}` | `chat_routes.py` | `ws_chat` | oui | WS | JWT dans le **premier message JSON** après `accept` (`decode_jwt`) + vérif membre conversation (certain) | — | — | — |
| WS | `/api/ws/notifications` | `chat_routes.py` | `ws_notifications` | oui | WS | JWT dans le **premier message JSON** après `accept` (`decode_jwt`) (certain) | — | — | — |
| WS | `/api/ws/spot-you/{point_id}` | `chat_routes.py` | `ws_spot_you` | oui | WS | JWT dans le **premier message JSON** après `accept` (`decode_jwt`) (certain) | — | — | — |
