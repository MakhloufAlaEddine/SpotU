# ENDPOINTS_CANONICAL_LIST.md — Liste canonique complète des endpoints SpotU
> 174 routes réellement joignables (171 HTTP + 3 WS). Préfixe global `/api`.
> Auth : OUI = require_auth | OPT = get_optional_auth | NON = aucune auth
> Type : HTTP | WS | ALIAS = double décorateur | SHADOW = shadowed par collision

---

## AUTH — préfixe `/api/auth`

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 1 | GET | `/api/auth/native-callback` | `native_callback` | `auth_routes.py:14` | OUI | NON | OAuth callback natif — **absent doc v1** |
| 2 | POST | `/api/auth/register` | `register_user` | `auth_routes.py:26` | OUI | NON | bcrypt + INSERT users |
| 3 | POST | `/api/auth/login` | `login_user` | `auth_routes.py:45` | OUI | NON | Rate limited |
| 4 | POST | `/api/auth/google` | `google_auth` | `auth_routes.py:60` | OUI | NON | Via proxy Emergent |
| 5 | GET | `/api/auth/me` | `get_me` | `auth_routes.py:92` | OUI | OUI | — |
| 6 | POST | `/api/auth/logout` | `logout` | `auth_routes.py:98` | OUI | OUI | Stateless (no-op) |
| 7 | PUT | `/api/auth/change-password` | `change_password` | `auth_routes.py:105` | OUI | OUI | — |

---

## USERS — préfixe `/api/users`

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 8 | GET | `/api/users/profile` | `get_profile` | `user_routes.py:11` | OUI | OUI | Profil connecté |
| 9 | PUT | `/api/users/profile` | `update_profile` | `user_routes.py:33` | OUI | OUI | — |
| 10 | POST | `/api/users/become-coach` | `become_coach` | `user_routes.py:84` | OUI | OUI | Upgrade role user→coach |
| 11 | GET | `/api/users/{user_id}/public` | `get_public_profile` | `user_routes.py:99` | OUI | OPT | — |
| 12 | GET | `/api/users/{user_id}/reviews` | `get_user_reviews` | `user_routes.py:238` | OUI | OPT | **absent doc v1** |
| 13 | PUT | `/api/users/{user_id}/reviews/{review_id}` | `update_review` | `user_routes.py:262` | OUI | OUI | **absent doc v1** |
| 14 | POST | `/api/users/{user_id}/reviews` | `create_review` | `user_routes.py:310` | OUI | OUI | **absent doc v1** |
| 15 | GET | `/api/users/me/activity-feed` | `activity_feed` | `user_routes.py:377` | OUI | OUI | **absent doc v1** |
| 16 | POST | `/api/users/{user_id}/follow` | `follow_user` | `user_routes.py:494` | OUI | OUI | **absent doc v1** |
| 17 | DELETE | `/api/users/{user_id}/follow` | `unfollow_user` | `user_routes.py:512` | OUI | OUI | **absent doc v1** |
| 18 | PATCH | `/api/users/{user_id}/cover` | `update_cover` | `user_routes.py:525` | OUI | OUI | **absent doc v1** |
| 19 | GET | `/api/users/{user_id}/followers` | `get_followers` | `user_routes.py:568` | OUI | OPT | **absent doc v1** |
| 20 | GET | `/api/users/{user_id}/following` | `get_following` | `user_routes.py:592` | OUI | OPT | **absent doc v1** |
| 21 | DELETE | `/api/users/{user_id}/followers/{follower_id}` | `remove_follower` | `user_routes.py:616` | OUI | OUI | **absent doc v1** |
| 22 | POST | `/api/users/{user_id}/block` | `block_user` | `user_routes.py:632` | OUI | OUI | **absent doc v1** |
| 23 | DELETE | `/api/users/{user_id}/block` | `unblock_user` | `user_routes.py:654` | OUI | OUI | **absent doc v1** |
| 24 | GET | `/api/users/{user_id}/suggestions` | `get_suggestions` | `user_routes.py:667` | OUI | OUI | **absent doc v1** |
| 25 | GET | `/api/users/search` | `search_users` | `user_routes.py:798` | OUI | OPT | Path correct : `/api/users/search` |

---

## PUSH — préfixe `/api/users` (push_router avec prefix=/users)

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 26 | POST | `/api/users/push-token` | `register_push_token` | `push_routes.py:15` | OUI | OUI | **doc v1 avait chemin INCORRECT** `/api/push-token` |
| 27 | DELETE | `/api/users/push-token` | `delete_push_token` | `push_routes.py:57` | OUI | OUI | **doc v1 avait chemin INCORRECT** |

---

## DOMAINS & TAGS — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 28 | GET | `/api/domains` | `list_domains` | `domain_routes.py:11` | OUI | NON |
| 29 | POST | `/api/domains` | `create_domain` | `domain_routes.py:22` | OUI | OUI (admin) |
| 30 | GET | `/api/tags/categories` | `list_tag_categories` | `domain_routes.py:36` | OUI | NON |
| 31 | POST | `/api/tags/categories` | `create_tag_category` | `domain_routes.py:88` | OUI | OUI (admin) |
| 32 | GET | `/api/tags` | `list_tags` | `domain_routes.py:102` | OUI | NON |
| 33 | POST | `/api/tags` | `create_tag` | `domain_routes.py:143` | OUI | OUI (admin) |
| 34 | PUT | `/api/domains/{domain_id}` | `update_domain` | `domain_routes.py:174` | OUI | OUI (admin) | **absent doc v1** |
| 35 | GET | `/api/domains/{domain_id}/usage` | `get_domain_usage` | `domain_routes.py:200` | OUI | OUI (admin) | **absent doc v1** |
| 36 | DELETE | `/api/domains/{domain_id}` | `delete_domain` | `domain_routes.py:222` | OUI | OUI (admin) | **absent doc v1** |
| 37 | PUT | `/api/tags/categories/{category_id}` | `update_category` | `domain_routes.py:244` | OUI | OUI (admin) | **absent doc v1** |
| 38 | GET | `/api/tags/categories/{category_id}/usage` | `get_category_usage` | `domain_routes.py:273` | OUI | OUI (admin) | **absent doc v1** |
| 39 | DELETE | `/api/tags/categories/{category_id}` | `delete_category` | `domain_routes.py:297` | OUI | OUI (admin) | **absent doc v1** |
| 40 | PUT | `/api/tags/{tag_id}` | `update_tag` | `domain_routes.py:323` | OUI | OUI (admin) | **absent doc v1** |
| 41 | GET | `/api/tags/{tag_id}/usage` | `get_tag_usage` | `domain_routes.py:343` | OUI | OUI (admin) | **absent doc v1** |
| 42 | DELETE | `/api/tags/{tag_id}` | `delete_tag` | `domain_routes.py:359` | OUI | OUI (admin) | **absent doc v1** |

---

## TAG POINTS (SpotYous) — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 43 | GET | `/api/tag-points` | `list_tag_points` | `tagpoint_routes.py:146` | OUI | OPT |
| 44 | GET | `/api/tag-points/mine` | `get_mine` | `tagpoint_routes.py:228` | OUI | OUI |
| 45 | GET | `/api/tag-points/saved` | `get_saved` | `tagpoint_routes.py:314` | OUI | OUI |
| 46 | GET | `/api/tag-points/{point_id}` | `get_tag_point` | `tagpoint_routes.py:389` | OUI | OPT |
| 47 | GET | `/api/tag-points/{point_id}/similar` | `similar_tag_points` | `tagpoint_routes.py:554` | OUI | OPT | **absent doc v1** |
| 48 | POST | `/api/tag-points/{point_id}/save` | `save_tag_point` | `tagpoint_routes.py:654` | OUI | OUI |
| 49 | DELETE | `/api/tag-points/{point_id}/unsave` | `unsave_tag_point` | `tagpoint_routes.py:672` | OUI | OUI |
| 50 | POST | `/api/tag-points/{point_id}/join` | `join_tag_point` | `tagpoint_routes.py:684` | OUI | OUI | Alias fonctionnel de #72 |
| 51 | DELETE | `/api/tag-points/{point_id}/cancel-request` | `cancel_join_request` | `tagpoint_routes.py:833` | OUI | OUI |
| 52 | POST | `/api/tag-points/{point_id}/invite` | `invite_user` | `tagpoint_routes.py:862` | OUI | OUI |
| 53 | GET | `/api/users/me/spotyou-invitations` | `get_my_invitations` | `tagpoint_routes.py:966` | OUI | OUI |
| 54 | POST | `/api/tag-points/{point_id}/invitations/accept` | `accept_invitation` | `tagpoint_routes.py:1007` | OUI | OUI |
| 55 | POST | `/api/tag-points/{point_id}/invitations/refuse` | `refuse_invitation` | `tagpoint_routes.py:1059` | OUI | OUI |
| 56 | GET | `/api/tag-points/{point_id}/join-requests` | `get_join_requests` | `tagpoint_routes.py:1107` | OUI | OUI |
| 57 | POST | `/api/tag-points/{point_id}/members/{member_id}/approve` | `approve_request` | `tagpoint_routes.py:1144` | OUI | OUI |
| 58 | POST | `/api/tag-points/{point_id}/members/{member_id}/reject` | `reject_request` | `tagpoint_routes.py:1212` | OUI | OUI |
| 59 | DELETE | `/api/tag-points/{point_id}/leave` | `leave_tag_point` | `tagpoint_routes.py:1264` | OUI | OUI | Alias fonctionnel de #74 |
| 60 | GET | `/api/tag-points/{point_id}/participants` | `get_participants` | `tagpoint_routes.py:1303` | OUI | OUI | **absent doc v1** |
| 61 | GET | `/api/users/me/pending-requests` | `get_pending_requests` | `tagpoint_routes.py:1325` | OUI | OUI | **absent doc v1** |
| 62 | GET | `/api/users/me/notifications` | `get_notifications` | `tagpoint_routes.py:1350` | OUI | OUI |
| 63 | PATCH | `/api/users/me/notifications/{notif_id}/read` | `mark_notif_read` | `tagpoint_routes.py:1394` | OUI | OUI |
| 64 | PATCH | `/api/users/me/notifications/read-all` | `mark_all_read` | `tagpoint_routes.py:1413` | OUI | OUI |
| 65 | GET | `/api/users/me/events` | `get_my_events` | `tagpoint_routes.py:1428` | OUI | OUI |
| 66 | GET | `/api/users/me/planning-events` | `get_planning_events` | `tagpoint_routes.py:1462` | OUI | OUI |
| 67 | GET | `/api/tag-points/{point_id}/my-vote` | `get_my_vote` | `tagpoint_routes.py:1703` | OUI | OUI | **absent doc v1** |
| 68 | POST | `/api/tag-points/{point_id}/vote` | `vote_tag_point` | `tagpoint_routes.py:1719` | OUI | OUI |
| 69 | GET | `/api/tag-points/{point_id}/votes` | `get_votes` | `tagpoint_routes.py:1791` | OUI | OPT | **absent doc v1** |
| 70 | POST | `/api/tag-points` | `create_tag_point` | `tagpoint_routes.py:1808` | OUI | OUI |
| 71 | PUT | `/api/tag-points/{point_id}` | `update_tag_point` | `tagpoint_routes.py:1866` | OUI | OUI |
| 72 | PATCH | `/api/tag-points/{point_id}/new-date` | `toggle_new_date` | `tagpoint_routes.py:2033` | OUI | OUI |

---

## SPOT-YOU — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 73 | POST | `/api/spot-you/{point_id}/join` | `join_spot_you` | `spot_you_routes.py:132` | OUI | OUI | Alias fonctionnel de #50 |
| 74 | DELETE | `/api/spot-you/{point_id}/leave` | `leave_spot_you` | `spot_you_routes.py:212` | OUI | OUI | Alias fonctionnel de #59 |
| 75 | POST | `/api/spot-you/{point_id}/going` | `going_spot_you` | `spot_you_routes.py:289` | OUI | OUI |
| 76 | DELETE | `/api/spot-you/{point_id}/going` | `not_going_spot_you` | `spot_you_routes.py:400` | OUI | OUI |
| 77 | GET | `/api/spot-you/my-completion-stats` | `my_completion_stats` | `spot_you_routes.py:461` | OUI | OUI |
| 78 | GET | `/api/spot-you/{point_id}/activity` | `spot_you_activity` | `spot_you_routes.py:495` | OUI | OPT |
| 79 | GET | `/api/spot-you/{point_id}/going` | `get_going_list` | `spot_you_routes.py:627` | OUI | NON | **absent doc v1** |

---

## HOME & DISCOVERY — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 80 | GET | `/api/home/nearest-sector` | `nearest_sector` | `home_routes.py:30` | OUI | OPT |
| 81 | GET | `/api/home/feed` | `home_feed` | `home_routes.py:152` | OUI | OPT |

---

## SERVICES — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 82 | GET | `/api/services` | `list_services` | `service_routes.py:352` | OUI | OPT |
| 83 | GET | `/api/services/mine` | `get_my_services` | `service_routes.py:416` | OUI | OUI |
| 84 | GET | `/api/services/saved` | `get_saved_services` | `service_routes.py:645` | OUI | OUI |
| 85 | GET | `/api/services/deactivated` | `get_deactivated` | `service_routes.py:687` | OUI | OUI |
| 86 | GET | `/api/services/{service_id}` | `get_service` | `service_routes.py:718` | OUI | OPT |
| 87 | POST | `/api/services` | `create_service` | `service_routes.py:756` | OUI | OUI |
| 88 | PUT | `/api/services/{service_id}` | `update_service` | `service_routes.py:852` | OUI | OUI | ALIAS: même handler que PATCH |
| 88b | PATCH | `/api/services/{service_id}` | `update_service` | `service_routes.py:853` | OUI | OUI | ALIAS (double décorateur) |
| 89 | DELETE | `/api/services/{service_id}` | `delete_service` | `service_routes.py:986` | OUI | OUI |
| 90 | POST | `/api/services/{service_id}/reactivate` | `reactivate_service` | `service_routes.py:1051` | OUI | OUI |
| 91 | POST | `/api/services/{service_id}/save` | `save_service` | `service_routes.py:1107` | OUI | OUI |
| 92 | DELETE | `/api/services/{service_id}/unsave` | `unsave_service` | `service_routes.py:1123` | OUI | OUI |

---

## BOOKINGS — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 93 | POST | `/api/bookings/price-preview` | `price_preview` | `booking_routes.py:115` | OUI | OUI |
| 94 | POST | `/api/bookings/request` | `request_booking` | `booking_routes.py:385` | OUI | OUI | Variante v2 |
| 95 | POST | `/api/bookings` | `create_booking` | `booking_routes.py:391` | OUI | OUI | Alias v1 retro-compat → même logique |
| 96 | POST | `/api/bookings/{booking_id}/accept` | `accept_booking` | `booking_routes.py:401` | OUI | OUI |
| 97 | POST | `/api/bookings/{booking_id}/pay` | `pay_booking` | `booking_routes.py:558` | OUI | OUI |
| 98 | POST | `/api/bookings/{booking_id}/refuse` | `refuse_booking` | `booking_routes.py:675` | OUI | OUI |
| 99 | POST | `/api/bookings/{booking_id}/cancel` | `cancel_booking` | `booking_routes.py:754` | OUI | OUI |
| 100 | PATCH | `/api/bookings/{booking_id}/status` | `update_booking_status` | `booking_routes.py:984` | OUI | OUI | **absent doc v1** |
| 101 | GET | `/api/bookings/me` | `my_bookings` | `booking_routes.py:1035` | OUI | OUI | ALIAS: même handler que #102 |
| 102 | GET | `/api/users/me/bookings` | `my_bookings` | `booking_routes.py:1036` | OUI | OUI | ALIAS (double décorateur) |
| 103 | GET | `/api/bookings/received` | `received_bookings` | `booking_routes.py:1059` | OUI | OUI | ALIAS: même handler que #104 |
| 104 | GET | `/api/receiver/requests` | `received_bookings` | `booking_routes.py:1060` | OUI | OUI | ALIAS (double décorateur) — chemin inhabituel |
| 105 | GET | `/api/bookings/{booking_id}` | `get_booking` | `booking_routes.py:1080` | OUI | OUI |

---

## ADMIN — préfixe `/api/admin`

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 106 | GET | `/api/admin/stats` | `get_stats` | `admin_routes.py:11` | OUI | OUI (admin) |
| 107 | GET | `/api/admin/users` | `get_users` | `admin_routes.py:53` | OUI | OUI (admin) |
| 108 | PUT | `/api/admin/users/{user_id}/role` | `set_user_role` | `admin_routes.py:75` | OUI | OUI (admin) |
| 109 | PUT | `/api/admin/users/{user_id}/verify-coach` | `verify_coach` | `admin_routes.py:93` | OUI | OUI (admin) |
| 110 | GET | `/api/admin/tag-points` | `admin_list_tag_points` | `admin_routes.py:107` | OUI | OUI (admin) | **absent doc v1** |
| 111 | DELETE | `/api/admin/tag-points/{point_id}` | `admin_delete_tag_point` | `admin_routes.py:118` | OUI | OUI (admin) | **absent doc v1** |
| 112 | GET | `/api/admin/services` | `admin_list_services` | `admin_routes.py:127` | OUI | OUI (admin) | **absent doc v1** |
| 113 | GET | `/api/admin/pricing-rules` | `get_pricing_rules` | `admin_routes.py:138` | OUI | OUI (admin) |
| 114 | POST | `/api/admin/pricing-rules` | `create_pricing_rule` | `admin_routes.py:149` | OUI | OUI (admin) |
| 115 | PUT | `/api/admin/pricing-rules/{rule_id}` | `update_pricing_rule` | `admin_routes.py:176` | OUI | OUI (admin) |
| 116 | DELETE | `/api/admin/pricing-rules/{rule_id}` | `delete_pricing_rule` | `admin_routes.py:199` | OUI | OUI (admin) |
| 117 | GET | `/api/admin/subscription-plans` | `get_admin_plans` | `admin_routes.py:210` | OUI | OUI (admin) | Gagne collision vs subscription_routes:151 |
| 118 | POST | `/api/admin/subscription-plans` | `create_plan` | `admin_routes.py:221` | OUI | OUI (admin) |
| 119 | PUT | `/api/admin/subscription-plans/{plan_id}` | `update_plan` | `admin_routes.py:252` | OUI | OUI (admin) |
| 120 | DELETE | `/api/admin/subscription-plans/{plan_id}` | `delete_plan` | `admin_routes.py:277` | OUI | OUI (admin) |
| 121 | GET | `/api/admin/domains` | `admin_domains` | `admin_routes.py:286` | OUI | OUI (admin) | Distinct de GET /api/domains |
| 122 | GET | `/api/admin/tags-analytics` | `tags_analytics` | `admin_routes.py:295` | OUI | OUI (admin) |
| 123 | GET | `/api/admin/all-domains` | `get_all_domains` | `admin_routes.py:385` | OUI | OUI (admin) |
| 124 | GET | `/api/admin/all-categories` | `get_all_categories` | `admin_routes.py:394` | OUI | OUI (admin) |
| 125 | GET | `/api/admin/all-tags` | `get_all_tags` | `admin_routes.py:408` | OUI | OUI (admin) |
| 126 | GET | `/api/admin/app-config` | `get_app_config` | `admin_routes.py:440` | OUI | OUI (admin) |
| 127 | POST | `/api/admin/purge` | `trigger_purge` | `admin_routes.py:451` | OUI | OUI (admin) |
| 128 | GET | `/api/admin/purge/status` | `purge_status` | `admin_routes.py:495` | OUI | OUI (admin) |
| 129 | PUT | `/api/admin/app-config` | `update_app_config` | `admin_routes.py:539` | OUI | OUI (admin) |

---

## CHAT & WEBSOCKET — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Type |
|---|---------|-------------|---------|--------------|--------|------|------|
| 130 | POST | `/api/conversations` | `create_conversation` | `chat_routes.py:227` | OUI | OUI | HTTP |
| 131 | GET | `/api/conversations` | `list_conversations` | `chat_routes.py:349` | OUI | OUI | HTTP |
| 132 | GET | `/api/conversations/{conv_id}/messages` | `get_messages` | `chat_routes.py:389` | OUI | OUI | HTTP |
| 133 | PUT | `/api/conversations/{conv_id}/read` | `mark_read` | `chat_routes.py:438` | OUI | OUI | HTTP |
| 134 | WS | `/ws/chat/{conv_id}` | `ws_chat` | `chat_routes.py:459` | OUI | OUI (query token) | **WS** |
| 135 | WS | `/ws/notifications` | `ws_notifications` | `chat_routes.py:606` | OUI | OUI (query token) | **WS** |
| 136 | WS | `/ws/spot-you/{point_id}` | `ws_spot_you` | `chat_routes.py:666` | OUI | OUI (query token) | **WS** |

---

## UPLOAD — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 137 | POST | `/api/upload-image/debug-422` | `debug_422` | `upload_routes.py:114` | OUI | ? | **Route debug interne — absent doc v1** |
| 138 | POST | `/api/upload-image` | `upload_image` | `upload_routes.py:125` | OUI | OUI | — |

---

## PAYMENTS — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 139 | GET | `/api/payments/me` | `my_payments` | `payment_routes.py:41` | OUI | OUI |
| 140 | GET | `/api/payments/{payment_id}` | `get_payment` | `payment_routes.py:62` | OUI | OUI |
| 141 | POST | `/api/payments/checkout/session` | `create_checkout` | `payment_routes.py:85` | OUI | OUI |
| 142 | GET | `/api/payments/checkout/status/{session_id}` | `checkout_status` | `payment_routes.py:195` | OUI | OUI |
| 143 | POST | `/api/webhook/stripe` | `stripe_webhook` | `payment_routes.py:356` | OUI | NON (sig Stripe) |
| 144 | PATCH | `/api/payments/{payment_id}/stripe` | `update_payment_stripe` | `payment_routes.py:410` | OUI | OUI | **absent doc v1** |
| 145 | GET | `/api/admin/payments` | `admin_payments` | `payment_routes.py:452` | OUI | OUI (admin) |
| 146 | GET | `/api/admin/payments/stats` | `admin_payment_stats` | `payment_routes.py:471` | OUI | OUI (admin) |
| 147 | GET | `/api/admin/subscriptions` | `admin_subscriptions` | `payment_routes.py:497` | OUI | OUI (admin) | Gagne collision vs subscription_routes:453 |

---

## SUBSCRIPTIONS — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 148 | GET | `/api/subscription-plans` | `list_plans` | `subscription_routes.py:130` | OUI | NON |
| 149 | ~~GET~~ | ~~`/api/admin/subscription-plans`~~ | ~~`admin_plans`~~ | `subscription_routes.py:151` | **SHADOW** | — | Shadowed par admin_routes.py:210 |
| 150 | GET | `/api/subscriptions/me` | `get_my_subscription` | `subscription_routes.py:165` | OUI | OUI | **absent doc v1** |
| 151 | GET | `/api/subscriptions/history` | `subscription_history` | `subscription_routes.py:199` | OUI | OUI | **absent doc v1** |
| 152 | POST | `/api/subscriptions/subscribe` | `subscribe` | `subscription_routes.py:217` | OUI | OUI |
| 153 | POST | `/api/subscriptions/cancel` | `cancel_subscription` | `subscription_routes.py:325` | OUI | OUI |
| 154 | GET | `/api/subscriptions/checkout/status/{session_id}` | `subscription_checkout_status` | `subscription_routes.py:404` | OUI | OUI | **absent doc v1** |
| 155 | ~~GET~~ | ~~`/api/admin/subscriptions`~~ | ~~`admin_list_subscriptions`~~ | `subscription_routes.py:453` | **SHADOW** | — | Shadowed par payment_routes.py:497 |
| 156 | POST | `/api/admin/subscriptions/{subscription_id}/cancel` | `admin_cancel_subscription` | `subscription_routes.py:472` | OUI | OUI (admin) | **absent doc v1** |

---

## ADDRESSES — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 157 | GET | `/api/addresses` | `get_addresses` | `address_routes.py:35` | OUI | OUI |
| 158 | POST | `/api/addresses` | `create_address` | `address_routes.py:53` | OUI | OUI |
| 159 | PUT | `/api/addresses/{address_id}` | `update_address` | `address_routes.py:77` | OUI | OUI |
| 160 | DELETE | `/api/addresses/{address_id}` | `delete_address` | `address_routes.py:99` | OUI | OUI |

---

## MARKETPLACE — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 161 | GET | `/api/marketplace/products` | `list_products` | `marketplace_routes.py:31` | OUI | OPT |

---

## PRODUCTS — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth |
|---|---------|-------------|---------|--------------|--------|------|
| 162 | GET | `/api/products/mine` | `my_products` | `product_creation_routes.py:41` | OUI | OUI |
| 163 | GET | `/api/products/{product_id}/detail` | `product_detail` | `product_creation_routes.py:77` | OUI | OPT |
| 164 | POST | `/api/products` | `create_product` | `product_creation_routes.py:113` | OUI | OUI |
| 165 | DELETE | `/api/products/{product_id}` | `delete_product` | `product_creation_routes.py:459` | OUI | OUI |
| 166 | POST | `/api/products/{product_id}/reactivate` | `reactivate_product` | `product_creation_routes.py:507` | OUI | OUI |

---

## ADMIN PRODUCTS — pas de préfixe (routes commencent par /admin)

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 167 | GET | `/api/admin/products/pending` | `list_pending_products` | `admin_product_routes.py:43` | OUI | OUI (admin) |
| 168 | GET | `/api/admin/products/{product_id}` | `get_product_detail` | `admin_product_routes.py:84` | OUI | OUI (admin) | **absent doc v1** |
| 169 | POST | `/api/admin/products/{product_id}/approve` | `approve_product` | `admin_product_routes.py:115` | OUI | OUI (admin) |
| 170 | POST | `/api/admin/products/{product_id}/reject` | `reject_product` | `admin_product_routes.py:161` | OUI | OUI (admin) |

---

## DELETION — pas de préfixe

| # | Méthode | Path complet | Handler | Fichier:ligne | Exposé | Auth | Notes |
|---|---------|-------------|---------|--------------|--------|------|-------|
| 171 | DELETE | `/api/users/{user_id}` | `delete_user` | `deletion_routes.py:97` | OUI | OUI |
| 172 | DELETE | `/api/tag-points/{point_id}` | `delete_tag_point` | `deletion_routes.py:260` | OUI | OUI |
| 173 | POST | `/api/tag-points/{point_id}/reactivate` | `reactivate_tag_point` | `deletion_routes.py:351` | OUI | OUI |
| 174 | DELETE | `/api/messages/{message_id}` | `delete_message` | `deletion_routes.py:436` | OUI | OUI |
| 175 | PATCH | `/api/conversations/{conv_id}/leave` | `leave_conversation` | `deletion_routes.py:481` | OUI | OUI |
| 176 | PATCH | `/api/users/{user_id}/deactivate` | `deactivate_user` | `deletion_routes.py:522` | OUI | OUI | **absent doc v1** |
| 177 | POST | `/api/users/{user_id}/reactivate` | `reactivate_user` | `deletion_routes.py:624` | OUI | OUI | **absent doc v1** |
| 178 | GET | `/api/users/me/reactivatable` | `get_reactivatable` | `deletion_routes.py:681` | OUI | OUI | **absent doc v1** |
