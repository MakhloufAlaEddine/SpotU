# ENDPOINTS_INVENTORY.md

**Préfixe API global** : `/api` (sauf montage statique séparé `/api/uploads/*` via `StaticFiles` dans `server.py`).

**Comptage décorateurs** : `grep -E '^@(router|api_router)\.' backend/routes/*.py backend/server.py` → **183** lignes (certain). Cela inclut :
- plusieurs décorateurs sur **une même** fonction (ex. `@router.get` ×2 + un handler unique) ;
- `@router.put` + `@router.patch` partageant `update_service` (`service_routes.py`).

**Estimation** : **~165–175 opérations HTTP/WebSocket exposées** (déduit) ; le détail par handler ci‑dessous reste la référence.

**Légende auth** (déduit par pattern sauf mention contraire) :
- **Public** : pas d’appel `require_auth` / `require_role` dans les premières lignes du handler (à revalider fichier par fichier pour les cas ambigus).
- **Bearer JWT** : `require_auth` ou `get_optional_auth` selon endpoint.
- **Admin** : `require_role(..., "admin")`.
- **WebSocket** : auth **à vérifier** dans le corps du handler (`chat_routes.py`).

**Erreurs** : en plus des codes métier, **429** possible sur routes décorées `@limiter.limit` (slowapi) ; handler global dans `server.py`.

---

## A. `server.py` (router `api_router`)

| Méthode | Route complète | Handler | Auth | Notes |
|---------|----------------|---------|------|--------|
| GET | `/api/liveness` | `liveness` | Public | JSON status |
| GET | `/api/readiness` | `readiness` | Public | 503 si DB KO |
| GET | `/api/config/booking` | `public_booking_config` | Public | Lit `app_config` |
| GET | `/api/config/commission` | `public_commission_config` | Public | Lit `pricing_rules` |

---

## B. `routes/auth_routes.py` — préfixe `/api/auth`

| Méthode | Route | Handler | Rate limit | Auth / remarques |
|---------|-------|---------|------------|------------------|
| GET | `/api/auth/native-callback` | `native_google_callback` | — | Public ; redirect 302 OAuth natif |
| POST | `/api/auth/register` | `register` | 5/min | Body `UserCreate` ; erreurs 400 email existant |
| POST | `/api/auth/login` | `login` | 5/min | Body `UserLogin` ; 401 invalid credentials |
| POST | `/api/auth/google` | `google_auth` | 10/min | Body `GoogleAuthRequest` ; appelle Emergent |
| GET | `/api/auth/me` | `get_me` | — | JWT |
| POST | `/api/auth/logout` | `logout` | — | JWT (invalidation côté client surtout) |
| PUT | `/api/auth/change-password` | `change_password` | — | JWT ; `PasswordChange` |

---

## C. `routes/user_routes.py` — préfixe `/api/users`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/users/profile` | `get_profile` |
| PUT | `/api/users/profile` | `update_profile` |
| POST | `/api/users/become-coach` | `become_coach` |
| GET | `/api/users/{user_id}/public` | `get_public_profile` |
| GET | `/api/users/{user_id}/reviews` | `get_user_reviews` |
| PUT | `/api/users/{user_id}/reviews/{review_id}` | `update_user_review` |
| POST | `/api/users/{user_id}/reviews` | `create_user_review` |
| GET | `/api/users/me/activity-feed` | `get_activity_feed` |
| POST | `/api/users/{user_id}/follow` | `follow_user` |
| DELETE | `/api/users/{user_id}/follow` | `unfollow_user` |
| PATCH | `/api/users/{user_id}/cover` | `update_cover` |
| GET | `/api/users/{user_id}/followers` | `list_followers` |
| GET | `/api/users/{user_id}/following` | `list_following` |
| DELETE | `/api/users/{user_id}/followers/{follower_id}` | `remove_follower` |
| POST | `/api/users/{user_id}/block` | `block_user` |
| DELETE | `/api/users/{user_id}/block` | `unblock_user` |
| GET | `/api/users/{user_id}/suggestions` | `suggest_follows` |
| GET | `/api/users/search` | `search_users` |

**Tables/services typiques** (déduit des noms) : `users`, `reviews`, `user_follows`, `user_blocks`, contenus agrégés pour activity feed — **détail SQL non extrait ligne à ligne dans cet audit**.

---

## D. `routes/domain_routes.py` — préfixe `/api`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/domains` | `get_domains` |
| POST | `/api/domains` | `create_domain` |
| GET | `/api/tags/categories` | `get_categories` |
| POST | `/api/tags/categories` | `create_category` |
| GET | `/api/tags` | `get_tags` |
| POST | `/api/tags` | `create_tag` |
| PUT | `/api/domains/{domain_id}` | `update_domain` |
| GET | `/api/domains/{domain_id}/usage` | `get_domain_usage` |
| DELETE | `/api/domains/{domain_id}` | `delete_domain` |
| PUT | `/api/tags/categories/{category_id}` | `update_category` |
| GET | `/api/tags/categories/{category_id}/usage` | `get_category_usage` |
| DELETE | `/api/tags/categories/{category_id}` | `delete_category` |
| PUT | `/api/tags/{tag_id}` | `update_tag` |
| GET | `/api/tags/{tag_id}/usage` | `get_tag_usage` |
| DELETE | `/api/tags/{tag_id}` | `delete_tag` |

**Tables** : `domains`, `tag_categories`, `tags`, tables de liaison (`tag_category_links`, `tag_entity_type_links`).

---

## E. `routes/tagpoint_routes.py` — préfixe `/api` (volume élevé)

Handlers observés (fichier `tagpoint_routes.py`) :

`search_tag_points`, `my_tag_points`, `get_saved_tag_points`, `get_tag_point`, `get_similar_tag_points`, `save_tag_point`, `unsave_tag_point`, `join_tag_point`, `cancel_join_request`, `invite_user_to_spotyou`, `get_my_invitations`, `accept_invitation`, `refuse_invitation`, `get_join_requests`, `approve_join_request`, `reject_join_request`, `leave_tag_point`, `get_tag_point_participants`, `get_my_pending_requests`, `get_my_notifications`, `mark_notification_read`, `mark_all_notifications_read`, `get_my_events`, `get_planning_events`, `get_my_vote`, `vote_tag_point`, `get_tag_point_votes`, `create_tag_point`, `update_tag_point`, `toggle_new_date_coming`.

**Routes** (combinaison méthode + chemin — certain depuis grep) :

- `GET /api/tag-points`, `GET /api/tag-points/mine`, `GET /api/tag-points/saved`, `GET /api/tag-points/{point_id}`, `GET /api/tag-points/{point_id}/similar`
- `POST/DELETE …/save`, `…/unsave`, `…/join`, `…/cancel-request`, `…/invite`, `…/invitations/accept|refuse`, `…/members/{member_id}/approve|reject`, `DELETE …/leave`
- `GET …/participants`, `GET …/join-requests`, `GET /api/users/me/pending-requests`, `GET/PATCH …/notifications…`, `GET /api/users/me/events`, `GET /api/users/me/planning-events`
- `GET/POST …/vote(s)`, `POST /api/tag-points`, `PUT /api/tag-points/{point_id}`, `PATCH …/new-date`

**Effets de bord** : notifications, membres SpotYou, votes, invitations — couplage fort avec `tag_points`, `spot_you_members`, tables de notifications (voir `DB_MAP.md`).

---

## F. `routes/spot_you_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| POST | `/api/spot-you/{point_id}/join` | `join_spot_you` |
| DELETE | `/api/spot-you/{point_id}/leave` | `leave_spot_you` |
| POST | `/api/spot-you/{point_id}/going` | `going_spot_you` |
| DELETE | `/api/spot-you/{point_id}/going` | `not_going_spot_you` |
| GET | `/api/spot-you/my-completion-stats` | `my_completion_stats` |
| GET | `/api/spot-you/{point_id}/activity` | `get_spot_you_activity` |
| GET | `/api/spot-you/{point_id}/going` | `get_spot_you_going` |

**Anomalie documentée (certain)** : `async def get_spot_you_members(point_id: str)` existe **sans** `@router.*` → **pas d’endpoint HTTP** associé dans l’état actuel du fichier.

---

## G. `routes/service_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/services` | `search_services` |
| GET | `/api/services/mine` | `my_services` |
| GET | `/api/services/saved` | `get_saved_services` |
| GET | `/api/services/deactivated` | `get_deactivated_services` |
| GET | `/api/services/{service_id}` | `get_service` |
| POST | `/api/services` | `create_service` |
| PUT/PATCH | `/api/services/{service_id}` | `update_service` (double décorateur) |
| DELETE | `/api/services/{service_id}` | `delete_service` |
| POST | `/api/services/{service_id}/reactivate` | `reactivate_service` |
| POST | `/api/services/{service_id}/save` | `save_service` |
| DELETE | `/api/services/{service_id}/unsave` | `unsave_service` |

**Tables** : `services`, `service_locations`, `service_slots`, `service_packages`, `service_saves`, `app_config` (flags réservation via helpers).

---

## H. `routes/booking_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| POST | `/api/bookings/price-preview` | `booking_price_preview` |
| POST | `/api/bookings/request` | `request_booking` |
| POST | `/api/bookings` | `create_booking` |
| POST | `/api/bookings/{booking_id}/accept` | `accept_booking` |
| POST | `/api/bookings/{booking_id}/pay` | `pay_booking` |
| POST | `/api/bookings/{booking_id}/refuse` | `refuse_booking` |
| POST | `/api/bookings/{booking_id}/cancel` | `cancel_booking` |
| PATCH | `/api/bookings/{booking_id}/status` | `update_booking_status` |
| GET | `/api/bookings/me` **et** `/api/users/me/bookings` | `my_bookings` (alias) |
| GET | `/api/bookings/received` **et** `/api/receiver/requests` | `received_bookings` (alias) |
| GET | `/api/bookings/{booking_id}` | `get_booking_detail` |

**Couplage** : `bookings`, `payments`, Stripe (`stripe_service`), `pricing_rules`, notifications.

---

## I. `routes/payment_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/payments/me` | `my_payments` |
| GET | `/api/payments/{payment_id}` | `get_payment` |
| POST | `/api/payments/checkout/session` | `create_checkout_session` |
| GET | `/api/payments/checkout/status/{session_id}` | `get_checkout_status` |
| POST | `/api/webhook/stripe` | `stripe_webhook` |
| PATCH | `/api/payments/{payment_id}/stripe` | `update_stripe_fields` |
| GET | `/api/admin/payments` | `admin_list_payments` |
| GET | `/api/admin/payments/stats` | `admin_payment_stats` |
| GET | `/api/admin/subscriptions` | `admin_subscriptions` |

**⚠️ Collision potentielle (certain)** : même chemin `GET /api/admin/subscriptions` déclaré aussi dans `subscription_routes.py` — voir `MIGRATION_RISKS.md`.

---

## J. `routes/subscription_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/subscription-plans` | `list_subscription_plans` |
| GET | `/api/admin/subscription-plans` | `admin_list_plans` |
| GET | `/api/subscriptions/me` | `get_my_subscription` |
| GET | `/api/subscriptions/history` | `get_subscription_history` |
| POST | `/api/subscriptions/subscribe` | `subscribe` |
| POST | `/api/subscriptions/cancel` | `cancel_subscription` |
| GET | `/api/subscriptions/checkout/status/{session_id}` | `get_subscription_checkout_status` |
| GET | `/api/admin/subscriptions` | `admin_list_subscriptions` |
| POST | `/api/admin/subscriptions/{subscription_id}/cancel` | `admin_cancel_subscription` |

**Fonction exportée (non HTTP)** : `handle_subscription_event` — appelée depuis `webhook_handlers.dispatch`.

---

## K. `routes/push_routes.py` — préfixe `/api/users`

| Méthode | Route | Handler |
|---------|-------|---------|
| POST | `/api/users/push-token` | `register_push_token` |
| DELETE | `/api/users/push-token` | `unregister_push_token` |

---

## L. `routes/upload_routes.py` — préfixe `/api` (router sans prefix supplémentaire)

| Méthode | Route | Handler |
|---------|-------|---------|
| POST | `/api/upload-image/debug-422` | `debug_upload` |
| POST | `/api/upload-image` | `upload_image` |

**Query** : `category` ; **Body** : multipart fichier.

---

## M. `routes/home_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/home/nearest-sector` | `nearest_sector` |
| GET | `/api/home/feed` | `home_feed` |

---

## N. `routes/marketplace_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/marketplace/products` | `get_marketplace_products` |

---

## O. `routes/product_creation_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/products/mine` | `get_my_products` |
| GET | `/api/products/{product_id}/detail` | `get_product_detail` |
| POST | `/api/products` | `create_product` |
| DELETE | `/api/products/{product_id}` | `delete_product` |
| POST | `/api/products/{product_id}/reactivate` | `reactivate_product` |

**Helper interne** : `_notify_admins_new_product` — effet de bord notifications.

---

## P. `routes/admin_product_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/admin/products/pending` | `list_pending_products` |
| GET | `/api/admin/products/{product_id}` | `get_product_for_review` |
| POST | `/api/admin/products/{product_id}/approve` | `approve_product` |
| POST | `/api/admin/products/{product_id}/reject` | `reject_product` |

---

## Q. `routes/admin_routes.py` — préfixe `/api/admin`

Endpoints admin (stats, users, rôles, coach verify, tag-points, services, pricing-rules CRUD, subscription-plans CRUD, domains/tags analytics, app-config, purge trigger/status) — liste complète dans le fichier ; **~30 handlers** (décompte grep).

**Effets de bord** : `trigger_purge` appelle logique purge (`admin_purge_worker.run_purge` ou équivalent — **à confirmer** dans le corps de `admin_routes.py`).

---

## R. `routes/chat_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| POST | `/api/conversations` | `create_or_get_conversation` |
| GET | `/api/conversations` | `list_conversations` |
| GET | `/api/conversations/{conv_id}/messages` | `get_messages` |
| PUT | `/api/conversations/{conv_id}/read` | `mark_read` |
| WS | `/api/ws/chat/{conv_id}` | `ws_chat` |
| WS | `/api/ws/notifications` | `ws_notifications` |
| WS | `/api/ws/spot-you/{point_id}` | `ws_spot_you` |

---

## S. `routes/address_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| GET | `/api/addresses` | `list_addresses` |
| POST | `/api/addresses` | `create_address` |
| PUT | `/api/addresses/{address_id}` | `update_address` |
| DELETE | `/api/addresses/{address_id}` | `delete_address` |

---

## T. `routes/deletion_routes.py`

| Méthode | Route | Handler |
|---------|-------|---------|
| DELETE | `/api/users/{user_id}` | `delete_user` |
| DELETE | `/api/tag-points/{point_id}` | `delete_tag_point` |
| POST | `/api/tag-points/{point_id}/reactivate` | `reactivate_tag_point` |
| DELETE | `/api/messages/{message_id}` | `delete_message` |
| PATCH | `/api/conversations/{conv_id}/leave` | `leave_conversation` |
| PATCH | `/api/users/{user_id}/deactivate` | `deactivate_user` |
| POST | `/api/users/{user_id}/reactivate` | `reactivate_user` |
| GET | `/api/users/me/reactivatable` | `get_reactivatable` |

**Effets de bord** : helpers `_schedule_file_deletions`, `_cancel_file_deletions`, `_mark_conversations_context_deleted` (fichier `deletion_routes.py`).

---

## U. Réexport / cohérence

- Pour toute route absente de cette liste, se référer au **grep** dans le dépôt :  
  `grep -n '^@router\.' backend/routes/*.py`  
  et aux alias multiples (`@router.get` répété).

---

## V. Statique

| Type | Chemin | Source |
|------|--------|--------|
| Fichiers | `/api/uploads/*` | `StaticFiles` → `ROOT_DIR / "uploads"` dans `server.py` |
