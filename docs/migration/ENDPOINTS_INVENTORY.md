# ENDPOINTS_INVENTORY.md — Inventaire complet des endpoints SpotU
> Généré le 2026-04-11. Toutes les routes sont préfixées `/api`.
> Auth = `require_auth` (JWT obligatoire) | Optional = `get_optional_auth` | None = aucune auth

---

## AUTH — `auth_routes.py` (prefix `/api/auth`)

### POST `/api/auth/register`
| | |
|---|---|
| Auth | None |
| Body | `{email, password, name, language?}` |
| Réponse | `{token, user}` |
| Erreurs | 400 (email dupliqué), 422 (validation Pydantic) |
| Effets | INSERT users, hash bcrypt |
| Priorité migration | **Élevée** |

### POST `/api/auth/login`
| | |
|---|---|
| Auth | None |
| Body | `{email, password}` |
| Réponse | `{token, user}` |
| Erreurs | 401 (credentials invalides) |
| Rate limit | Oui (routes sensibles) |
| Priorité migration | **Élevée** |

### POST `/api/auth/google`
| | |
|---|---|
| Auth | None |
| Body | `{session_id}` |
| Réponse | `{token, user}` |
| Dépendances | `fetch_emergent_session()` → HTTP GET vers Emergent |
| Effets | UPSERT users (email match) |
| Priorité migration | **Moyenne** (dépendance externe Emergent) |

### GET `/api/auth/me`
| | |
|---|---|
| Auth | Oui |
| Réponse | `dict user` |
| Priorité migration | **Élevée** |

### POST `/api/auth/logout`
| | |
|---|---|
| Auth | Oui |
| Réponse | `{success: true}` (stateless — invalide uniquement côté client) |
| Note | Pas de blacklist token côté serveur |
| Priorité migration | **Faible** |

### PUT `/api/auth/change-password`
| | |
|---|---|
| Auth | Oui |
| Body | `{current_password, new_password}` |
| Réponse | `{success: true}` |
| Erreurs | 400 (mot de passe incorrect) |
| Priorité migration | **Moyenne** |

---

## USERS — `user_routes.py` (prefix `/api/users`)

### GET `/api/users/profile`
Auth requis. Retourne le profil complet de l'utilisateur connecté.

### PUT `/api/users/profile`
Auth requis. Body = `UserUpdate` partiel. Met à jour le profil.

### POST `/api/users/become-coach`
Auth requis. Upgrade role user → coach (non-admin). Effets: UPDATE users SET role='coach'.

### GET `/api/users/{user_id}/public`
Auth optional. Retourne le profil public enrichi (services, avis, stats).

### GET/POST/PUT `/api/users/{user_id}/reviews`
Auth requis pour write. CRUD avis profil utilisateur (table `reviews` type profil).

### GET `/api/users/me/activity-feed`
Auth requis. Feed d'activité (follows, SpotYous rejoints, etc.).

### POST/DELETE `/api/users/{user_id}/follow` + `/api/users/{user_id}/followers`
Auth requis. Suivi social (table `user_follows`).

### POST/DELETE `/api/users/{user_id}/block`
Auth requis. Blocage (table `user_blocks`).

### GET `/api/users/{user_id}/suggestions`
Auth requis. Suggestions de comptes à suivre.

### PATCH `/api/users/{user_id}/cover`
Auth requis. Met à jour cover_picture.

### GET `/api/users/search`
Auth optional. Recherche utilisateurs par `q`.

| Priorité migration | **Moyenne** (user_routes.py entier) |

---

## TAG POINTS (SpotYous) — `tagpoint_routes.py` + `spot_you_routes.py`

### GET `/api/tag-points`
| | |
|---|---|
| Auth | Optional |
| Query | `lat, lng, radius_km, domain_id, tag_ids, q, limit, offset` |
| Réponse | Liste de TagPoints enrichis |
| Note | PostGIS ST_DWithin, obfuscation selon precision |
| Priorité migration | **Élevée** |

### GET `/api/tag-points/mine`
Auth requis. SpotYous de l'utilisateur connecté (incluant désactivés).

### GET `/api/tag-points/saved`
Auth requis. SpotYous sauvegardés (table `tag_point_saves`).

### POST `/api/tag-points`
| | |
|---|---|
| Auth | Oui |
| Body | `TagPointCreate` |
| Effets | INSERT tag_points, INSERT spot_you_members (owner accepted), notifications optionnelles |
| Priorité migration | **Élevée** |

### GET `/api/tag-points/{point_id}`
| | |
|---|---|
| Auth | Optional |
| Réponse | TagPoint enrichi + `join_status`, `is_participant`, `is_owner`, `participants_count` |
| Note | Calcul `join_status` depuis spot_you_members |
| Priorité migration | **Élevée** |

### PUT `/api/tag-points/{point_id}`
Auth requis, owner only. Met à jour le SpotYou.

### GET `/api/tag-points/{point_id}/similar`
Auth optional. SpotYous similaires (même domaine, même zone).

### POST/DELETE `/api/tag-points/{point_id}/save` + unsave
Auth requis. Gestion favoris SpotYous.

### POST `/api/tag-points/{point_id}/join`
| | |
|---|---|
| Auth | Oui |
| Logique | public+open → accepted direct ; needs_approval → pending ; private → 403 |
| Effets | INSERT/UPDATE spot_you_members, notifications admins si pending |
| Erreurs | 403 (privé), 409 (déjà membre ou pending) |
| Priorité migration | **Élevée** |

### DELETE `/api/tag-points/{point_id}/cancel-request`
Auth requis. Annule une demande pending. Effets: UPDATE spot_you_members SET status='rejected', notif owner.

### POST `/api/tag-points/{point_id}/invite`
Auth requis, admin ou membre selon invite_permissions. Invite un utilisateur (INSERT invited).

### GET `/api/users/me/spotyou-invitations`
Auth requis. Invitations reçues.

### POST `/api/tag-points/{point_id}/invitations/accept`
Auth requis. Accepte l'invitation (UPDATE status → accepted).

### POST `/api/tag-points/{point_id}/invitations/refuse`
Auth requis. Refuse l'invitation (UPDATE status → rejected).

### GET `/api/tag-points/{point_id}/join-requests`
Auth requis, admin ou membre selon join_mode. Retourne la liste des `pending`.

### POST `/api/tag-points/{point_id}/members/{member_id}/approve`
| | |
|---|---|
| Auth | Oui, admin only |
| Effets | UPDATE spot_you_members SET status='accepted', notif utilisateur |
| Erreurs | 409 (déjà traité — concurrence) |

### POST `/api/tag-points/{point_id}/members/{member_id}/reject`
Auth requis, admin only. UPDATE status='rejected'. 409 si déjà traité.

### DELETE `/api/tag-points/{point_id}/leave` (alias `/api/spot-you/{point_id}/leave`)
Auth requis. Quitte la communauté. Effets: DELETE spot_you_members, annulation participations futures.

### POST/DELETE `/api/spot-you/{point_id}/going` + not_going
Auth requis. RSVP participation à une session (table `spot_you_attendance`).

### GET `/api/spot-you/{point_id}/activity`
Auth optional. Activité récente (membres rejoints, participations).

### GET `/api/spot-you/{point_id}/going`
Public. Liste des participants "going" pour une session.

### GET `/api/users/me/events`
Auth requis. SpotYous dont l'utilisateur est membre (avec is_owner, can_participate).

### GET `/api/users/me/planning-events`
Auth requis. Événements dans le planning de l'utilisateur.

### POST/GET `/api/tag-points/{point_id}/vote`
Auth requis / public. Vote (1-5) sur un SpotYou.

### GET `/api/users/me/notifications`
Auth requis. Notifications enrichies (avec sender_info, recipient_is_admin).

### PATCH `/api/users/me/notifications/{notif_id}/read`
Auth requis. Marquer une notification lue.

### PATCH `/api/users/me/notifications/read-all`
Auth requis. Marquer toutes les notifications lues.

### PATCH `/api/tag-points/{point_id}/new-date`
Auth requis, owner. Toggle `new_date_coming`.

---

## SERVICES — `service_routes.py` (prefix `/api`)

### GET `/api/services`
Auth optional. Recherche services (filtres: domain, tags, lat/lng, q).

### GET `/api/services/mine`
Auth requis. Services du coach connecté.

### GET `/api/services/saved`
Auth requis. Services sauvegardés.

### GET `/api/services/deactivated`
Auth requis. Services désactivés (soft delete).

### GET `/api/services/{service_id}`
Auth optional. Détail service enrichi (slots, locations, packages, avis).

### POST `/api/services`
Auth requis. Création service. Body = `ServiceCreate`. Effets: INSERT services + slots + locations + packages.

### PUT/PATCH `/api/services/{service_id}`
Auth requis, owner. Mise à jour service (slots/locations/packages inclus).

### DELETE `/api/services/{service_id}`
Auth requis, owner. Soft delete. Effets: `deleted_at=NOW()`, schedule purge médias J+90.

### POST `/api/services/{service_id}/reactivate`
Auth requis, owner. Réactivation (annule le soft delete si < 90j).

### POST/DELETE `/api/services/{service_id}/save` + unsave
Auth requis. Gestion favoris services.

| Priorité migration | **Élevée** (flux métier central) |

---

## BOOKINGS — `booking_routes.py` (prefix `/api`)

### POST `/api/bookings/price-preview`
| | |
|---|---|
| Auth | Oui |
| Body | `{service_id, slot_id?, payment_mode?}` |
| Réponse | PricingResult (base_amount, fees, payer_total, etc.) |
| Note | Appel `pricing_engine.compute_pricing()` — pas d'insertion |
| Priorité migration | **Élevée** |

### POST `/api/bookings/request` (alias POST `/api/bookings`)
| | |
|---|---|
| Auth | Oui |
| Body | `BookingRequest` |
| Logique | `_do_booking_request()` : vérifie slot dispo, calcule prix, INSERT booking + payment |
| Effets | INSERT bookings, INSERT payments, slot → pending, notif receiver, push |
| Idempotence | `idempotency_key` (UNIQUE booking) |
| Erreurs | 400 (slot non dispo), 409 (idempotency_key existant) |
| Priorité migration | **Élevée** |

### POST `/api/bookings/{booking_id}/accept`
| | |
|---|---|
| Auth | Oui, receiver |
| Logique | Vérifie paiement, capture Stripe (PaymentIntent), UPDATE booking confirmed, UPDATE slot booked |
| Effets | `capture_payment_intent()`, notif payer, UPDATE payments.status='capture_pending' |
| Erreurs | 400 (déjà accepté), 403 (pas receiver) |
| Priorité migration | **Élevée** |

### POST `/api/bookings/{booking_id}/pay`
Auth requis, payer. Crée session Stripe Checkout. Effets: `create_checkout_session()`, UPDATE payment.

### POST `/api/bookings/{booking_id}/refuse`
Auth requis, receiver. Refuse. Effets: annule PaymentIntent Stripe, UPDATE booking/payment/slot, notif payer.

### POST `/api/bookings/{booking_id}/cancel`
Auth requis, payer ou receiver. Body = `{reason?}`. Logique complexe (annulation selon statut).

### PATCH `/api/bookings/{booking_id}/status`
Auth requis. Mise à jour admin du statut.

### GET `/api/bookings/me`
Auth requis. Réservations payer.

### GET `/api/bookings/received`
Auth requis. Réservations receiver.

### GET `/api/bookings/{booking_id}`
Auth requis. Détail booking.

| Priorité migration | **Élevée** — complexité forte, Stripe imbriqué |

---

## PAYMENTS — `payment_routes.py`

### GET `/api/payments/me`
Auth requis. Paiements de l'utilisateur connecté.

### GET `/api/payments/{payment_id}`
Auth requis. Détail paiement (payer ou receiver uniquement).

### POST `/api/payments/checkout/session`
Auth requis. Crée Checkout Session. Body: `{booking_id, success_url, cancel_url}`.

### GET `/api/payments/checkout/status/{session_id}`
Auth requis. Poll statut session Stripe Checkout. Effets: peut déclencher UPDATE payment/booking.

### POST `/api/webhook/stripe`
| | |
|---|---|
| Auth | Signature Stripe (header `Stripe-Signature`) |
| Logique | `parse_webhook_event()` → `webhook_handlers.dispatch()` |
| Effets | Transitions payment/subscription + notifications |
| Priorité migration | **Critique** |

### GET `/api/admin/payments`
Admin only. Liste paginée des paiements.

### GET `/api/admin/payments/stats`
Admin only. Stats agrégées.

---

## SUBSCRIPTIONS — `subscription_routes.py`

### GET `/api/subscription-plans`
Public. Plans actifs.

### POST `/api/subscriptions/subscribe`
Auth requis. Body: `{plan_id}`. Crée session Stripe subscription. Effets: `ensure_subscription_price()`, `create_subscription_checkout_session()`.

### POST `/api/subscriptions/cancel`
Auth requis. Annule abonnement actif. `cancel_subscription()` Stripe.

### GET `/api/subscriptions/checkout/status/{session_id}`
Auth requis. Poll statut checkout abonnement.

### GET/POST `/api/admin/subscriptions/{subscription_id}/cancel`
Admin only.

---

## CHAT & WEBSOCKET — `chat_routes.py`

### POST `/api/conversations`
Auth requis. Crée ou récupère une conversation. Body: `{type, context_id, participant_ids}`.

### GET `/api/conversations`
Auth requis. Liste des conversations enrichies (dernier message, unread count).

### GET `/api/conversations/{conv_id}/messages`
Auth requis. Messages paginés (`limit`, `before` cursor).

### PUT `/api/conversations/{conv_id}/read`
Auth requis. Marque la conversation lue.

### WS `/ws/chat/{conv_id}?token=JWT`
WebSocket chat temps réel.

### WS `/ws/notifications?token=JWT`
WebSocket notifications globales.

### WS `/ws/spot-you/{point_id}?token=JWT`
WebSocket activité SpotYou.

| Priorité migration | **Faible** (WebSocket complexe — migrer en dernier) |

---

## HOME & DISCOVERY — `home_routes.py`, `marketplace_routes.py`

### GET `/api/home/nearest-sector`
Auth optional. Secteur géographique le plus proche (commune, ville).

### GET `/api/home/feed`
| | |
|---|---|
| Auth | Optional |
| Query | `lat, lng, domain_id?` |
| Réponse | `{spot_yours, services, products}` scorés par pertinence |
| Note | Algorithme de scoring interne `_score_spot`, `_score_service` |
| Priorité migration | **Moyenne** |

### GET `/api/marketplace/products`
Public. Filtres: `q, type, domain_id, lat, lng, radius_km, pricing_mode`.

---

## UPLOAD — `upload_routes.py`

### POST `/api/upload-image`
| | |
|---|---|
| Auth | Oui |
| Body | multipart/form-data `file` |
| Effets | Compression PIL, upload R2 boto3, retourne URL publique |
| Erreurs | 413 (taille), 415 (format non supporté) |
| Priorité migration | **Moyenne** |

---

## PRODUCTS — `product_creation_routes.py`, `admin_product_routes.py`

### GET `/api/products/mine`
Auth requis. Produits du vendeur.

### GET `/api/products/{product_id}/detail`
Auth optional. Détail produit.

### POST `/api/products`
Auth requis. Création produit. Effets: INSERT marketplace_products, notif admins si `pending_review`.

### DELETE `/api/products/{product_id}`
Auth requis, owner. Soft delete.

### POST `/api/products/{product_id}/reactivate`
Auth requis, owner.

### GET `/api/admin/products/pending`
Admin only. Produits en attente de validation.

### POST `/api/admin/products/{product_id}/approve`
Admin only. Valide le produit. Effets: UPDATE status='active', notif owner.

### POST `/api/admin/products/{product_id}/reject`
Admin only. Rejette. Body: `{reason?}`. Effets: UPDATE status='rejected', notif owner.

---

## ADMIN — `admin_routes.py`

### GET `/api/admin/stats`
Admin only. Stats globales (users, bookings, payments, tag_points, services).

### GET/PUT `/api/admin/users`
Admin only. Liste + mise à jour rôles/vérifications coaches.

### GET/POST/PUT/DELETE `/api/admin/pricing-rules`
Admin only. CRUD règles tarifaires.

### GET/POST/PUT/DELETE `/api/admin/subscription-plans`
Admin only. CRUD plans d'abonnement.

### GET `/api/admin/tags-analytics`
Admin only. Statistiques d'utilisation des tags.

### GET/PUT `/api/admin/app-config`
Admin only. Configuration globale de l'app (enable_manual_approval, pay_later...).

### POST `/api/admin/purge`
Admin only. Déclenche purge manuelle des fichiers (appel `admin_purge_worker.run_purge()`).

### GET `/api/admin/purge/status`
Admin only. Statut de la file de purge (`pending_file_deletions`).

---

## DELETION — `deletion_routes.py`

### DELETE `/api/users/{user_id}`
| | |
|---|---|
| Auth | Oui (admin OU self) |
| Effets | Soft delete: `deleted_at=NOW()`, `media_purge_scheduled_at=NOW()+90j`, anonymisation données personnelles, schedule purge fichiers, marque conversations context_deleted |

### DELETE `/api/tag-points/{point_id}`
Auth requis, owner ou admin. Soft delete SpotYou.

### POST `/api/tag-points/{point_id}/reactivate`
Auth requis, owner. Réactivation (< 90j sinon médias purgés).

### DELETE `/api/messages/{message_id}`
Auth requis. Soft delete message (deleted_at).

### PATCH `/api/conversations/{conv_id}/leave`
Auth requis. Quitte conversation.

### PATCH `/api/users/{user_id}/deactivate`
Auth requis. Désactive le compte (active=false, push tokens supprimés).

### POST `/api/users/{user_id}/reactivate`
Auth requis, admin ou self. Réactive le compte.

---

## PUSH TOKENS — `push_routes.py`

### POST `/api/push-token`
Auth requis. Enregistre token Expo push.

### DELETE `/api/push-token`
Auth requis. Supprime token Expo push.

---

## ADDRESSES — `address_routes.py`

### GET/POST/PUT/DELETE `/api/addresses`
Auth requis. CRUD adresses sauvegardées (`user_saved_addresses`).

---

## DOMAINS & TAGS — `domain_routes.py`

### GET `/api/domains`
Public. Liste domaines actifs.

### POST `/api/domains`
Admin only. Création domaine.

### GET `/api/tags/categories`
Public. Catégories de tags (filtrable par domain_id, entity_type).

### GET `/api/tags`
Public. Tags (filtrable par category_id, domain_id, entity_type).

### POST/PUT/DELETE `/api/tags`, `/api/tags/categories`, `/api/domains/{id}`
Admin only. CRUD taxonomie.

---

## SPOT-YOU COMPLETION — `spot_you_routes.py`

### GET `/api/spot-you/my-completion-stats`
Auth requis. Statistiques de complétion des SpotYous de l'utilisateur.

---

## Rate Limiting (visible dans server.py)

Certains endpoints sensibles (auth, upload) ont un décorateur `@limiter.limit("X/minute")`.
**Note Cursor** : en Spring Boot, remplacer par `@RateLimiter` (Resilience4j) ou Bucket4j.
