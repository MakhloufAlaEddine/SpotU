# KNOWN_GAPS_VS_PYTHON.md

Écarts entre ce backend Java et le backend Python actuel.  
Mis à jour après **slice 41** (marketplace admin moderation).

## Parité URL / port

| Sujet | Python | Java | Action |
|-------|--------|------|--------|
| Port par défaut | souvent `8000` / Uvicorn | `8080` (`server.port`) | Configurer `SERVER_PORT` ou reverse-proxy |
| Préfixe global | `/api` via `APIRouter` | Identique pour les routes créées | OK |

## Readiness

| Sujet | Python | Java |
|-------|--------|------|
| Détails erreur | `database: pool_not_initialized` ou message d’exception | Message JDBC simplifié | Affiner au besoin |
| Pool | `asyncpg` pool | HikariCP | OK conceptuellement |

## Config publique (`/api/config/booking`, `/api/config/commission`)

| Sujet | Python | Java (slice 01) |
|-------|--------|-----------------|
| Source de données | `app_config` / `pricing_rules` | **Identique** (JdbcTemplate + SQL aligné `server.py`) | OK |
| Erreur SQL / DB | Exception non gérée → souvent **500** côté FastAPI | **`DataAccessException` → 503** + `ErrorResponse` JSON (`GlobalExceptionHandler`) | **Écart volontaire** (meilleure sémantique « service indisponible ») ; aligner sur 500 si contrat strict requis |

## Uploads / statique

| Sujet | Python | Java |
|-------|--------|------|
| `POST /api/upload-image` | Implémenté | **Implémenté** (slice 24: auth stricte, 15 Mo, magic bytes, R2 + fallback local) |
| `POST /api/upload-image/debug-422` | Implémenté | **Implémenté** (slice 24) |
| `/api/uploads/**` | `StaticFiles` | **Absent** | `ResourceHandlerRegistry` ou CDN |

## Profil write / cover / push — slice 24

| Sujet | Python | Java (slice 24) |
|-------|--------|-----------------|
| `PUT /api/users/profile` | update dynamique + clearable fields + delete ancienne picture | implémenté (même logique clearables, validation `name`, delete old picture) |
| Champs JSONB (`coach_tags`, `goals`, `user_roles`) | `::jsonb` asyncpg | sérialisation JSON string côté JDBC (équivalent fonctionnel) |
| `POST /api/users/become-coach` | `user -> coach`, bloque `coach/admin` | identique |
| `PATCH /api/users/{user_id}/cover` | ownership strict + delete old cover | identique |
| `POST /api/push-token` | format Expo + upsert/réactivation/transfert | identique |
| `DELETE /api/push-token` | soft-disable `is_active=false` | identique |
| Endpoint de lecture profil | `/api/users/profile` | Java conserve `/api/users/me` (écart historique slice 03) |

## Home feed / nearest sector — slice 25

| Sujet | Python | Java (slice 25) |
|-------|--------|-----------------|
| `GET /api/home/nearest-sector` | auth optionnelle + PostGIS nearest + `null` si vide | implémenté |
| `GET /api/home/feed` | auth optionnelle + auto-expansion 50/100/200/500 + scoring mix SpotYou/Services | implémenté |
| Ordre `ST_MakePoint` | `(lng, lat)` | identique |
| PostGIS prod | requis | requis (requêtes PostGIS) |
| Environnement test sans PostGIS | N/A | fallback H2 approximatif (distance euclidienne) pour non-régression CI |

## SpotYou / TagPoints lecture — slice 26

| Sujet | Python | Java (slice 26) |
|-------|--------|------------------|
| Endpoints | `GET /tag-points`, `/mine`, `/saved`, `/{id}`, `/{id}/similar`, `/{id}/participants`, `GET /users/me/pending-requests` | Préfixe `/api` identique au reste du backend Java (`/api/tag-points/...`, `/api/users/me/pending-requests`) |
| Filtre tags recherche | opérateur PostgreSQL `?|` sur `tag_ids` | `jsonb_exists_any(COALESCE(tag_ids::jsonb,'[]'), ARRAY[...])` — même sémantique (au moins un tag), sans conflit caractère `?` / JDBC |
| Détail : parallélisme | `asyncio.gather` (4 + 3 connexions) | Requêtes **séquentielles** dans une même transaction lecture (même résultat, latence potentielle plus élevée) |
| Recherche : offset GPS non-owner | `apply_precision_offset` **sans** `seed` (Python relance `random.seed()` après) | `applyPrecisionOffset(..., seed=null)` → décalage **non déterministe** entre appels, comme Python |
| Similar / détail coordonnées | `build_point_response` sans offset supplémentaire sur similar | Identique (pas d’offset sur `/similar`) |
| `get_next_session_date` | Utilise `event_schedule` puis `event_date` (pas `schedule`) | `NextSessionDateCalculator` aligné : **plus** de repli sur le champ `schedule` (écart corrigé vs ancienne version Java) |
| Seed offset « même point » (hors recherche) | `random.seed(hash(point_id))` (hash Python 64 bits) | `new Random(point_id.hashCode())` — **non parité binaire** avec Python (documenté dans les slices métier) |
| Recherche géo + PostGIS | Une passe SQL | Si la requête PostGIS échoue → fallback H2 ; si l’instance répond « 0 ligne » sans exception alors que des `latitude`/`longitude` existent (cas edge), liste vide possible — non observé sur Postgres réel |

## SpotYou membership / social — slice 27

| Sujet | Python | Java (slice 27) |
|-------|--------|------------------|
| Endpoints | `POST/DELETE …/save|unsave|join|cancel-request|leave|invite`, `GET /users/me/spotyou-invitations`, `POST …/invitations/accept|refuse`, `GET …/join-requests`, `POST …/members/{id}/approve|reject` | Même contrat sous `/api` (`SpotYouMembershipController`, `UserProfileController` pour les invitations) |
| `ON CONFLICT DO UPDATE WHERE status='rejected'` (join) | SQL Postgres natif | **Équivalent** : `UPDATE … WHERE status='rejected'` puis `INSERT` ; si doublon sans mise à jour → `DataIntegrityViolationException` ignorée (comportement idempotent comme le `ON CONFLICT` no-op) |
| Push `asyncio.create_task(send_push_to_user)` | Expo + persistance notification | **`SpotYouPushSideEffectService`** `@Async` : **INSERT `notifications` uniquement** ; **pas d’appel Expo** (fire-and-forget, erreurs absorbées) — voir `SLICE_27_IMPLEMENTED.md` |
| `invite_permissions` null | `or "admin_only"` | Identique ; la valeur schéma de test H2 `members` est mappée sur `admin_and_members` pour coller à l’intention « membres peuvent inviter » |
| `my-invitations` / `invited_at` | `str(invited_at)` côté Python | ISO normalisé via `PythonIsoTimestamps` (écart de format possible vs chaîne brute Python) |
| Approbation si `join_mode=open` | Pas de garde explicite : un non-membre peut théoriquement approuver un `pending` résiduel | **Reproduit** (mêmes conditions `if admin_approval` / `if members_approval` uniquement) |

## SpotYou CRUD (create / update / new-date) — slice 28

| Sujet | Python | Java (slice 28) |
|-------|--------|------------------|
| Endpoints | `POST/PUT /tag-points`, `PATCH …/new-date` | `TagPointWriteController` sous `/api/tag-points` |
| PostGIS `INSERT` | `ST_SetSRID(ST_MakePoint(lng,lat),4326)` | Identique sur **Postgres** (`jdbc:postgresql:`) ; **H2** : colonnes `latitude` / `longitude` |
| Auto-membre owner | `ON CONFLICT DO NOTHING` | Postgres : identique ; **H2** : `INSERT … SELECT … WHERE NOT EXISTS` (même sémantique) |
| `randomize_for_storage` | `random` sans seed | `GeoRandomizer` : **nouveau `Random()`** à chaque appel — distinct de `apply_precision_offset` (S26 lecture) |
| Update SQL dynamique | asyncpg + `?::jsonb` | `CAST(? AS jsonb)` sur Postgres ; chaîne JSON sur H2 |
| `_vals_equal` / JSON | `json.dumps(sort_keys=True)` | `ObjectMapper` + `ORDER_MAP_ENTRIES_BY_KEYS` + comparaison `JsonNode` |
| Images retirées | `delete_upload_files` | `FileStorageService.deleteUploadFile` par URL |
| Push « SpotYou mis à jour » | `asyncio.create_task` | `SpotYouPushSideEffectService` `@Async` (persist `notifications` ; pas Expo — voir slice 27) |
| Validateur `event_schedule` (fin > début) | Pydantic | Contrôle équivalent dans `TagPointWriteService` |

## SpotYou lifecycle (delete / reactivate) — slice 29

| Sujet | Python | Java (slice 29) |
|-------|--------|------------------|
| Endpoints | `DELETE /tag-points/{id}`, `POST /tag-points/{id}/reactivate` | `TagPointLifecycleController` sous `/api/tag-points` |
| Ordre des guards | 404 → 409 → 403 | Reproduit strictement dans `TagPointLifecycleService` |
| Soft-delete | `active=FALSE`, `deleted_at`, `deleted_by`, `media_purge_scheduled_at=now+90d` | Identique |
| Reactivate | `active=TRUE`, reset `deleted_*`, reset purge scheduling/notif, `reactivated_at=now` | Identique |
| Conversations | `context_deleted=TRUE/FALSE` selon delete/reactivate | Identique (`conversations` table) |
| Pending deletions | INSERT `ON CONFLICT DO NOTHING` à la suppression ; cancel seulement `status='pending'` à la réactivation | Postgres : identique ; H2 tests : fallback `INSERT ... WHERE NOT EXISTS` |
| `requires_media_reupload` | `= media_purged` | Identique |
| Push hors transaction | `asyncio.create_task` après release pool | Reproduit via hook `afterCommit` (`TransactionSynchronizationManager`) + `SpotYouPushSideEffectService` |
| Destinataires push | Delete exclut owner ; reactivate exclut caller (asymétrie conservée) | Identique |

## Booking buyer core (preview / request / pay) — slice 30

| Sujet | Python | Java (slice 30) |
|-------|--------|------------------|
| Endpoints | `POST /bookings/price-preview`, `POST /bookings/request`, alias `POST /bookings`, `POST /bookings/{id}/pay` | `BookingController` sous `/api/bookings` (mêmes routes/alias) |
| Pricing serveur-only | `pricing_engine.compute_pricing(...)` | `BookingPricingEngine` (règles `pricing_rules` actives, mêmes champs de snapshot) |
| Guards request | `service active`, `payment_mode`, self-booking, flags globaux `app_config` | Identique (messages/codes alignés, y compris asymétrie `pay_later` 409 global OFF vs 400 service OFF) |
| Lock concurrence slot | `SELECT ... FOR UPDATE NOWAIT`, lock error -> 409 | Identique (SQL NOWAIT + mapping 409 non bloquant) |
| Idempotence request | clé explicite + tuple `(slot_id,user_id)` -> retour 200 booking existant | Identique (aucun flag `idempotent`) |
| Flux statut create | `instant_booking -> awaiting_payment/reserved`, `manual_approval -> requested/pending` + TTL | Identique (TTL `pay_now_checkout_minutes`, `pay_later_expiration_minutes`, fallback 30/1440/48h) |
| `INSERT bookings` | `payment_status='pending'`, `currency='EUR'` hardcodés | Identique |
| Idempotence pay Stripe | session existante `open` -> retour `reused=true` | Identique (`url` + `checkout_url` dupliqués) |
| Stripe URLs | success avec token `{CHECKOUT_SESSION_ID}`, cancel sur `/bookings` | Identique |
| Side-effects create | push coach hors transaction | Reproduit via `afterCommit` (insert `notifications`, pas Expo) |
| Scope non migré | `accept/refuse/cancel/read` et checkout status déjà migrés slices précédentes | inchangé |

## Checkout status post-Stripe — slice 31

| Sujet | Python | Java (slice 31) |
|-------|--------|------------------|
| Endpoint | `GET /payments/checkout/status/{session_id}` | `GET /api/payments/checkout/status/{sessionId}` |
| Auth | optionnelle (`require_auth` try/except silencieux) | équivalent effectif (`SecurityConfig` permitAll global + `JwtAuthFilter` best-effort, jamais 401) |
| Lookup paiement | `stripe_checkout_session_id OR stripe_payment_intent_id` | identique (`CheckoutRepository.findBySessionOrIntentId`) |
| Fallback Stripe down | return 200 `"status":"unknown"` sans `stripe_status` | identique + log warn aligné |
| Ordre branches | `if complete+unpaid` -> `elif paid` -> `elif expired+authorized` | identique (`CheckoutService.getCheckoutStatus`) |
| Branche 1-A instant | update payment->captured + booking->confirmed/paid + push x2 sync | identique (push sync via insert `notifications`, pas `@Async`) |
| Branche 1-B manual | update payment->authorized + booking.payment_status->authorized | identique |
| Branche 2 | capture si `stripe_ps='paid'` | identique |
| Branche 3 | cancel si `expired` + db `authorized` | identique |
| `amount_total == 0` | fallback DB (falsy Python) | identique (`amountTotal > 0` sinon fallback DB) |
| `currency` | conserve casse source Stripe/DB | identique |

## Sécurité

| Sujet | Python | Java |
|-------|--------|------|
| Auth métier | `require_auth`, `require_role`, etc. | **Slice 23** : bloc auth canonique en place (`AuthService`, `AuthMeService`, `JwtService`, `JwtAuthFilter`, extraction header/cookie, `requireAdmin`) ; les handlers métier continuent d’appeler les services auth comme en FastAPI |
| CORS | `ALLOWED_ORIGINS` strict en prod | Aligné : `app.cors.allowed-origins` (`APP_CORS_ALLOWED_ORIGINS`) + `allowCredentials(true)` + méthodes/headers explicites |

## Auth complet (`/api/auth/*`) — slice 23

| Sujet | Python | Java (slice 23) |
|-------|--------|-----------------|
| Endpoints | register, login, google, me, logout, change-password (+ native-callback) | couverts |
| JWT secret | `JWT_SECRET` obligatoire | `app.jwt.secret` (`JWT_SECRET`) obligatoire ; même secret Python/Java |
| Extraction token | Header Bearer puis cookie `winek_token` | identique (`TokenExtractor`) |
| `verify_password("x","")` | `false` (try/except) | identique : guard hash vide + catch exception (`false`) |
| Google OAuth | Session Emergent propriétaire (`X-Session-ID`) | identique (`EmergentOAuthClient`) |
| Rate limit | SlowAPI 5/min register/login, 10/min google | équivalent en mémoire (`AuthRateLimiter`) |
| Validation register/change-password | Pydantic -> 422 | **400** via exceptions métier (écart format/code conservé) |

## `GET /api/auth/me`

| Sujet | Python | Java (slice 23) |
|-------|--------|-----------------|
| Erreurs SQL pendant le handler | Souvent **500** FastAPI implicite | **`DataAccessException` → 503** (handler global inchangé) — même remarque que la config publique |
| Filtre `SecurityFilterChain` sur `/api/auth/me` | N/A (vérif dans le handler) | `permitAll()` conservé ; auth appliquée dans `AuthMeService` (comportement équivalent) |

## `GET /api/users/profile` (Java: `/api/users/me`) — slice 03

| Sujet | Python | Java (slice 03) |
|-------|--------|-----------------|
| Chemin | `/api/users/profile` | `/api/users/me` (renommage de migration demandé) |
| Auth | `require_auth` dans le handler | Réutilise `AuthMeService.requireCurrentUser` (mêmes messages 401) |
| `avg_rating` | `round(sum/count, 1)` Python (arrondi bancaire) | `BigDecimal` + `RoundingMode.HALF_EVEN` (comportement Python reproduit) |
| Erreurs SQL pendant le handler | Souvent **500** FastAPI implicite | **`DataAccessException` → 503** via handler global (écart conservé) |

## `GET /api/users/{user_id}/public` (Java: `/api/users/{userId}/public`) — slice 04

| Sujet | Python | Java (slice 04) |
|-------|--------|-----------------|
| Auth | Optionnelle (try/except `require_auth`) | Optionnelle via décodage JWT best-effort ; token invalide ignoré (`me_id = null`) |
| Code erreur user inexistant | `404 {"detail":"User not found"}` | Identique via `ApiNotFoundException` |
| Chemin | `/api/users/{user_id}/public` | `/api/users/{userId}/public` (identique fonctionnel) |
| Erreurs SQL pendant le handler | Souvent **500** FastAPI implicite | **`DataAccessException` → 503** via handler global (écart conservé) |

## `POST/DELETE /api/users/{user_id}/follow` — slice 05

| Sujet | Python | Java (slice 05) |
|-------|--------|-----------------|
| Follow idempotent | `INSERT ... ON CONFLICT DO NOTHING` | `INSERT ... SELECT ... WHERE NOT EXISTS` (idempotence équivalente, compatible H2 tests) |
| Asymétrie follow/unfollow | follow: 400+404 possibles ; unfollow: silencieux | Identique |
| Format erreur 400/404 | `{"detail":"..."}` | Identique via exceptions dédiées + handler global |

## `GET /api/users/{user_id}/followers|following` — slice 06

| Sujet | Python | Java (slice 06) |
|-------|--------|-----------------|
| Auth | optionnelle (`get_optional_auth`) | optionnelle (resolver best-effort sur token, même effet) |
| user_id inexistant | `[]` (HTTP 200) | identique |
| Pagination | aucune | aucune |
| Tri | `ORDER BY u.name ASC` | identique SQL |
| Champs asymétriques | `is_following_back` vs `follows_back` | identique (DTOs distincts) |

## `POST/DELETE /api/users/{user_id}/block` — slice 07

| Sujet | Python | Java (slice 07) |
|-------|--------|-----------------|
| Block idempotent | `INSERT ... ON CONFLICT DO NOTHING` | `INSERT ... SELECT ... WHERE NOT EXISTS` (équivalent fonctionnel, compatible H2 tests) |
| Effet block sur follows | suppression bidirectionnelle dans `user_follows` | identique |
| Unblock | delete silencieux, sans restore de follows | identique |
| Existence cible au block | pas de vérification applicative (possible erreur FK côté DB) | idem : pas de vérification applicative |

## `GET /api/users/{user_id}/reviews` — slice 08

| Sujet | Python | Java (slice 08) |
|-------|--------|-----------------|
| Auth | aucune | aucune |
| show_reviews=false | `[]` (200) | identique |
| user inexistant | `404 {"detail":"User not found"}` | identique |
| Pagination | aucune | aucune |

## `GET /api/services`, `GET /api/services/{service_id}` — slice 09

| Sujet | Python | Java (slice 09) |
|-------|--------|-----------------|
| Auth liste/détail | soft/optionnelle, token invalide ignoré | identique (best-effort JWT + lookup user) |
| Liste | `active=TRUE`, `LIMIT 100`, slots/packages vides | identique |
| Détail | enrichissement complet + `is_owner` coach/admin | identique |
| `avg_rating` | calculé par `reviewee_id=coach_id` | identique |
| Géolocalisation | `ST_DWithin` PostGIS | `ST_DWithin` implémenté avec fallback approximation si PostGIS/colonne `location` indisponible (dev/H2) |

## `GET /api/domains`, `GET /api/tags/categories`, `GET /api/tags` — slice 10

| Sujet | Python | Java (slice 10) |
|-------|--------|-----------------|
| Auth | aucune | aucune |
| `/domains` include_inactive | public, expose aussi les inactifs si `true` | identique |
| `/tags/categories` groupement | 2 requêtes + groupement applicatif | identique |
| `/tags` branches SQL | A/B/C, `DISTINCT` conditionnel, `LIMIT 200` | identique |
| `linked_category_id` | supprimé avant réponse | identique (jamais exposé) |

## `GET /api/bookings/me|received|{booking_id}` — slice 11

| Sujet | Python | Java (slice 11) |
|-------|--------|-----------------|
| Auth | stricte (`require_auth`) | identique (`AuthMeService.requireCurrentUser`) |
| Aliases | `/users/me/bookings`, `/receiver/requests` | identique (routes alias actives) |
| Tri & pagination | `created_at DESC`, sans pagination | identique |
| Contrôle d'accès détail | 4 champs booking + admin | identique |
| `pricing_snapshot` legacy string | parsing conditionnel | identique |

## `POST /api/bookings/{booking_id}/refuse` — slice 12

| Sujet | Python | Java (slice 12) |
|-------|--------|-----------------|
| Auth | stricte, receiver uniquement | identique (pas d'exception admin) |
| Idempotence `status=refused` | 200 + `idempotent=true` | identique |
| Garde statut | refuse autorisé uniquement depuis `requested` | identique |
| Update payments | `cancelled` si status in (`requires_authorization`,`authorized`) | identique |
| Update slot | `available` uniquement si slot_status=`pending` | identique |
| Stripe | hors transaction, erreur avalée | identique (`StripePaymentService` + SDK `stripe-java`, slice 19) |
| Push `booking_refused` | fire-and-forget vers payer legacy (`bookings.user_id`) | **non implémenté v1** (écart mineur documenté) |

## `POST /api/bookings/{booking_id}/accept` — slice 13

| Sujet | Python | Java (slice 13) |
|-------|--------|-----------------|
| Auth | stricte, receiver **ou** admin | identique |
| Idempotence | `awaiting_payment`/`accepted`/`confirmed` -> 200 + statut réel + `idempotent=true` | identique |
| Garde TTL | `expires_at < now` -> 410 | identique |
| Cas A (`pay_now` + `authorized`) | `confirmed` + `payment_status=captured` + `expires_at=null`, update `payments` par `payment_id`, slot -> `booked` (`pending`,`available`,`reserved`) | identique |
| Cas B (autres) | `awaiting_payment` + `expires_at` calculé, pas d'update `payments`, slot -> `reserved` (`pending`,`available`) | identique |
| Source expiry pay_now | `app_config.pay_now_checkout_minutes`, fallback 30 | identique |
| Source expiry pay_later | `services.pay_later_expiration_minutes`, fallback 1440 | identique |
| Stripe capture Cas A | hors transaction, erreur avalée | identique (`StripePaymentService.capturePaymentIntent`, slice 19) |
| Push `booking_accepted`/`booking_confirmed` | fire-and-forget | **non implémenté v1** (écart mineur documenté) |

## `completed` via legacy `PATCH /api/bookings/{booking_id}/status` (Java: `POST /api/bookings/{booking_id}/complete`) — slice 14

| Sujet | Python | Java (slice 14) |
|-------|--------|-----------------|
| Auth | stricte, receiver **ou** admin | identique |
| Garde statut | aucune (n'importe quel statut source peut passer `completed`) | identique (aucun 409 ajouté) |
| Update booking | `status='completed'`, `updated_at=NOW()` | identique |
| Update slot | sous-requête corrélée `(SELECT slot_id FROM bookings ...)` + `slot_status='booked'` | identique (même SQL, no-op silencieux si `slot_id` null) |
| Update payments | `status='captured'` si `status='authorized'` | identique |
| Stripe | aucun appel | identique |
| Push | aucune notification | identique |
| Réponse succès | `{success,status}` | identique |

## `POST /api/bookings/{booking_id}/cancel` — slice 15

| Sujet | Python | Java (slice 15) |
|-------|--------|-----------------|
| Auth | stricte, payer/receiver/admin | identique |
| Règles asymétriques | receiver non payer/non admin uniquement sur `accepted` (sinon 409) | identique |
| Compat legacy payer | `is_payer` sur `user_id` ou `payer_user_id` | identique |
| Idempotence déjà cancelled | 200 + `idempotent=true` | identique |
| États non annulables | `completed`/`refused`/`expired` -> 409 | identique |
| Payment matrix | cancel/refund/unchanged selon `pay_status` | identique |
| Refund Stripe | basé sur `stripe_charge_id`; si absent warning + DB quand même | identique |
| `stripe_action` | `pi_cancelled` / `refund_created` / `null` | identique |
| Stripe exécution | appels Stripe réels hors transaction | identique (`StripePaymentService`, slice 19) |
| Push notifications | 3 patterns (payer/receiver/admin) | **non implémenté v1** (écart mineur documenté) |

## `POST /api/webhook/stripe` (infrastructure webhook + handlers) — slices 32 + 33 + 35 + 20

| Sujet | Python | Java (slice 32 infra + slices 33/35/20 handlers) |
|-------|--------|-----------------|
| Auth user | aucune | identique |
| Body brut pour signature | requis | identique (`@RequestBody byte[]`) |
| Signature Stripe | `Stripe-Signature` + `STRIPE_WEBHOOK_SECRET` | identique (`Webhook.constructEvent(...)` Stripe SDK) |
| Idempotence | table `stripe_webhook_events` | identique |
| Dispatcher central | `dispatch(pool, event_id, event_type, obj)` | identique (point unique `StripeWebhookService.process`) |
| Status DB event | `processing -> success/error` | identique (`claimEvent` puis `markDone`) |
| Set `_PAYMENT_EVENTS` | 5 events (`checkout.session.completed`, `payment_intent.amount_capturable_updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`) | identique (slice 33) |
| `_resolve_payment_id` ordre | metadata -> PI -> checkout session -> charge | identique (`PaymentResolverService`) |
| `checkout.session.completed` paiement | 3 branches (`unpaid+awaiting`, `unpaid+other`, `paid`) | identique (guards + transitions slice 33) |
| `payment_intent.succeeded` | capture + sync booking + stockage `stripe_charge_id` | identique (`latest_charge` string `ch_*` only) |
| `payment_intent.payment_failed` / `payment_intent.canceled` | `failed` avec notif payer / `cancelled` sans notif | identique |
| Set `_CHARGE_EVENTS` | `charge.refunded`, `refund.updated` | identique (slice 35) |
| `charge.refunded` | full/partial + `refund_amount` + `refund_status='succeeded'` + notif payer | identique (`ChargeEventHandler`) |
| `refund.updated` | phase 1 full-refund edge case puis phase 2 sync `refund_status`, sans notif | identique |
| `stripe_charge_id` write | `COALESCE(stripe_charge_id, charge_id)` | identique |
| Dual routing `checkout.session.completed` | paiement puis abonnement ; chaque handler filtre `mode` | identique (slice 20) |
| Webhook abonnements (6 types) | `_handle_subscription_event` | **slice 20** : `SubscriptionWebhookHandler` + `SubscriptionWebhookRepository` |
| `customer.subscription.deleted` | UPDATE sans garde `NOT IN ('cancelled')` | identique |
| Erreur handler interne | log + persist event error | identique |
| Code HTTP sur erreurs signature/parse/event invalide | Python lève `400` | identique (`ApiBadRequestException` -> 400) |
| Notifications webhook | `store_notification` réel | identique pour paiements/refunds (slices 33/35) et abonnements (slice 20) |

## `POST /api/payments/checkout/session`, `GET /api/payments/checkout/status/{session_id}` — slice 17

| Sujet | Python | Java (slice 17) |
|-------|--------|-----------------|
| POST auth | stricte (`require_auth`) | identique (`AuthMeService.requireCurrentUser`) |
| POST non-payer | `404 "Paiement non trouvé"` (pas 403) | identique (filtre payer dans le `WHERE`) |
| Montant checkout | snapshot `payments.payer_total_amount` uniquement | identique |
| Placeholder success URL | `{CHECKOUT_SESSION_ID}` littéral Stripe | identique (conservé littéral) |
| Idempotence session open | réutilise `stripe_checkout_session_id` si session Stripe `open` | identique |
| GET auth | optionnelle (token absent accepté) | identique |
| GET lookup | `stripe_checkout_session_id` **ou** `stripe_payment_intent_id` | identique |
| Graceful retrieve Stripe KO | `200` + `status="unknown"` | identique |
| Transitions DB GET/status | `complete/unpaid` (2 branches), `paid`, `expired+authorized` | identique |
| Push sur branche instant (`awaiting_payment`) | envoi réel de notifications | **non implémenté v1** (écart mineur documenté) |

## `GET /api/payments/me`, `GET /api/payments/{payment_id}` — slice 34

| Sujet | Python | Java (slice 34) |
|-------|--------|-----------------|
| Auth | Bearer JWT + fallback cookie `winek_token` | identique (`AuthMeService.requireCurrentUser` / `TokenExtractor`) |
| `/me` pagination | aucune | identique (retour liste brute) |
| `/me` filtre scope | `payer_user_id = uid OR receiver_user_id = uid` | identique |
| `/me` enrichissement noms | `LEFT JOIN users` (`payer_name`, `receiver_name`) | identique |
| `/me` tri | `ORDER BY created_at DESC` | identique |
| `/{id}` ordre erreurs | 404 puis 403 | identique |
| `/{id}` permissions | payer OR receiver OR admin | identique |
| `pricing_rule_snapshot` | parse si string JSON, sinon inchangé | identique |
| Format datetime | ISO `+00:00` (microsecondes) | identique (`PythonIsoTimestamps`) |
| BigDecimal/Decimal JSON | number JSON | identique |
| Asymétrie list vs détail | `payer_name/receiver_name` seulement sur `/me` | identique |

## `GET /api/bookings/me|received|{booking_id}` — slice 36 (audit régression)

| Sujet | Python | Java (slice 36) |
|-------|--------|-----------------|
| Contrats API | inchangés depuis S11 | inchangés (pas de réécriture endpoint) |
| Aliases | `/users/me/bookings`, `/receiver/requests` | identique |
| Permissions `/{id}` | 4-OR (`user_id`,`payer_user_id`,`receiver_user_id`,`coach_id`) + admin | identique |
| Ordre erreurs détail | 404 puis 403 | identique |
| Projections asymétriques (3 endpoints) | oui | identique |
| `pricing_snapshot` string JSON | parse conditionnel silencieux | identique |
| Datetime | ISO `+00:00` | identique |
| Post-S33 (`confirmed/paid`) visible en lecture | oui | identique |
| Post-S35 refund | pas de JOIN payments (`refund_*` absent des booking reads) | identique |

## `POST /api/bookings/price-preview` — slice 37 (audit no-op)

| Sujet | Python | Java (slice 37) |
|-------|--------|-----------------|
| Couverture fonctionnelle | déjà spécifiée en S30 | déjà couverte par S30 (inchangée) |
| Auth obligatoire | oui | identique |
| Validation body | `service_id` requis (400) | identique |
| Service actif | `active=TRUE` sinon 404 | identique |
| Pricing | `pricing_engine.compute_pricing(...)` | identique |
| Flags `app_config` | non consultés par price-preview | identique |
| Réponse | montants + `currency='EUR'` | identique |

## `GET /api/marketplace/products` — slice 38

| Sujet | Python | Java (slice 38) |
|-------|--------|-----------------|
| Endpoint public | pas d'auth | identique (`/api/marketplace/products`) |
| Wrapper réponse | `{"products":[...],"count":N}` | identique |
| Mode feed sans params | produits actifs récents (limit 20), sans services | identique |
| Filtre tags | produits + services si tags présents | identique |
| `spotyou_id` invalide | 200 + liste vide | identique |
| Owner badges | `owner/other` + labels (`SpotU` / `Coach`) | identique |
| Distances | haversine (R=6371), format `m`/`km` | identique |
| `seller_stats` | ratings + counts produits/services/spotyou | identique (requêtes parallèles) |
| `seller_picture` + `seller_picture_url` | doublon legacy | identique |

## `ExpiryWorker` — slice 18

| Sujet | Python | Java (slice 18) |
|-------|--------|-----------------|
| Tick startup | immédiat | identique (ApplicationReadyEvent) |
| Tick périodique | 60s (config env) | identique (`expiry.worker.interval.secs`) |
| Batch size | 50 | identique |
| Drain loop | boucle tant que `count >= 50` | identique |
| Locking | `FOR UPDATE OF b SKIP LOCKED` (native) | identique (requête native JDBC) |
| Transitions `bookings/payments/service_slots` | expiré/annulé/libéré selon guards | identique |
| Notifications | INSERT DB (payer + receiver, textes asymétriques) | identique |
| Stripe cancel PI | hors transaction, erreur avalée | identique (`StripePaymentService.cancelPaymentIntent`, slice 19) |

## Abonnements utilisateur (`/api/subscription-plans`, `/api/subscriptions/*`) — slice 21

| Sujet | Python | Java (slice 21) |
|-------|--------|-----------------|
| Auth | `require_auth` sur tous sauf liste plans | `AuthMeService.requireCurrentUser` |
| `POST /cancel` ordre | Stripe puis DB | identique |
| Garde subscribe | `active/cancelling/trialing` (sans `past_due`) | identique |
| `/me` | `past_due` inclus, pas de 404 si vide | identique (`subscription: null` via map mutable, pas `Map.of`) |
| Idempotence checkout | `sub_cs_{user}_{plan}_{time//300}` | identique |
| `currency` plan | `plan.get("currency","EUR")` | **EUR** en dur côté appel Stripe si non porté par le SELECT `findPlanById` (pas de colonne `currency` dans ce SELECT) |
| Erreurs SQL handler | souvent 500 FastAPI | **`DataAccessException` → 503** (inchangé, autres slices) |

## Admin subscriptions / plans — slice 22

| Sujet | Python | Java (slice 22) |
|-------|--------|-----------------|
| Auth | `require_role(..., "admin")` | `AuthMeService.requireAdmin` → `403` + `Requires admin role` |
| GET plans admin (doublon routes) | 2 enregistrements FastAPI | **Un** endpoint canonique (`admin_routes.py` : `ORDER BY priority DESC, created_at`) |
| DELETE plan + FK `user_subscriptions` | Exception non gérée → **500** | **`409`** + message métier (`DataIntegrityViolationException`) |
| DELETE plan absent | `200 {success:true}` | identique |
| PUT plan | pas de sync Stripe | identique |
| Admin cancel | `{success, status}` seulement | identique ; corps JSON invalide ignoré comme S21 cancel |

## Webhooks / workers / rate limit

- **Stripe webhook** : paiements booking (slice 33), refunds charge (`charge.refunded`, `refund.updated`, slice 35) et événements abonnements portés en slice 20 (`SubscriptionWebhookHandler`).
- **Checkout Stripe** (slice 17) : appels réseau Stripe côté session / statut (hors périmètre slice 19 qui couvre capture/cancel/refund du cycle accept/refuse/cancel/expiry).
- **Abonnements utilisateur (hors webhook)** : **slice 21** — voir `SLICE_21_IMPLEMENTED.md`.
- **Abonnements admin** : **slice 22** — `GET/POST/PUT/DELETE /api/admin/subscription-plans`, `GET /api/admin/subscriptions`, `POST /api/admin/subscriptions/{id}/cancel` (voir `SLICE_22_IMPLEMENTED.md`). **Un seul** `GET` plans admin (doublon FastAPI non reproduit).
- **slowapi**, **autres workers** (purge, etc.) : **non portés** — voir audits `migration_audit/` effets de bord.

## Marketplace seller create/edit — slice 39

| Sujet | Python | Java (slice 39) |
|-------|--------|------------------|
| Paths seller | `/api/products`, `/api/products/mine`, `/api/products/{id}/detail` | identiques (pas de préfixe `/api/marketplace`) |
| Format erreur 400 | `{"error":"..."}` | identique |
| Format erreur 403 | `{"detail":"..."}` | identique |
| Format erreur 422 | `{"error":"...", "details":[...]}` | identique |
| `/detail` ownership KO | `404` opaque `{"error":"Produit introuvable ou accès refusé."}` | identique |
| UPSERT applicatif | SELECT ownership puis INSERT/UPDATE | identique (pas de `ON CONFLICT DO UPDATE`) |
| Anti-downgrade draft | `403` si status courant non draft/null et body draft | identique |
| Parse price virgule | `"12,50"` accepté | identique |
| `delivery_modes` fallback | helper `_delivery_modes` | identique |
| `/mine` filtre | `status != 'deleted'` et `product_type in ('rental','sale')` | identique |
| Atomicité writes | Python fragmenté (plusieurs écritures) | Java consolidé en `@Transactional` (amélioration robuste, même résultat API en succès) |
| Colonnes arrays DB | dépend DDL Supabase (`text[]`/`jsonb`) | H2 tests stockés en JSON string ; audit DDL prod requis avant cutover |

## Marketplace lifecycle seller — slice 40

| Sujet | Python | Java (slice 40) |
|-------|--------|------------------|
| Endpoints | `DELETE /api/products/{id}` ; `POST /api/products/{id}/reactivate` | identiques |
| DELETE permission | owner-only, pas de bypass admin | identique |
| DELETE 404 opaque | inexistant / non-owner / déjà deleted -> `{"error":"Produit introuvable ou non autorisé."}` | identique |
| DELETE effet DB | soft-delete + `media_purge_scheduled_at=now+90j` + planification `pending_file_deletions` | identique |
| Reactivate permission | owner OU admin | identique |
| Reactivate checks order | 404 -> 409 -> 403 | identique |
| Reactivate statut | force `status='active'` | identique |
| Reactivate pending deletions | supprime uniquement `status='pending'` | identique |
| Reactivate payload | `{ok, reactivated, product_id, media_purged, requires_media_reupload}` | identique |
| Worker cadence | 3600s | `${media.purge.interval.secs:3600}` |
| Worker idempotence | `media_purged=false`, `status='deleted'`, `reactivated_at IS NULL OR reactivated_at < deleted_at` | identique |
| Purge physique fichiers | `admin_purge_worker.run_purge(...)` | **stub log-only** (`MarketplaceFilePurgeService`) ; marquage DB `media_purged` couvert, purge R2 à compléter |

## Marketplace admin moderation — slice 41

| Sujet | Python | Java (slice 41) |
|-------|--------|------------------|
| Endpoints | `/api/admin/products/pending`, `/{id}`, `/{id}/approve`, `/{id}/reject` | identiques |
| Auth admin | helper `_require_admin` | `requireCurrentUser` + check rôle admin |
| 403 format | `{"detail":"Admin only"}` | identique |
| 404 format | `{"error":"Produit introuvable."}` | identique |
| GET pending | FIFO `created_at ASC` + quality_score SQL | identique |
| GET detail | `SELECT p.*` + `seller_email` + quality_score | identique |
| Approve/reject guards | aucun guard sur statut courant | identique (anomalie conservée) |
| Approve sur deleted | possible (résurrection) | identique (anomalie conservée) |
| Reject DB write | `rejection_reason = admin_comment = comment` | identique |
| Reminder worker | cadence 600s, update `admin_reminder_sent_at`, notif admins | identique |
| image_urls | utilisé avec `jsonb_array_length` | PostgreSQL: expression `jsonb` conservée ; H2: fallback SQL compatible tests |

## Note de consolidation S39/S40

- La logique S41 confirme un usage `image_urls` en mode `jsonb` côté PostgreSQL (via `jsonb_array_length`).
- Les slices S39/S40 sont fonctionnelles sur l’environnement de test H2 (stockage chaîne JSON), mais le mapping PostgreSQL final des champs arrays/jsonb reste à consolider globalement avant cutover total.

## Services coach reads — slice 42

| Sujet | Python | Java (slice 42) |
|-------|--------|------------------|
| Endpoints | `/api/services`, `/api/services/mine`, `/api/services/saved`, `/api/services/deactivated`, `/api/services/{id}` | identiques |
| Auth search/detail | optionnelle (JWT invalide ignoré) | identique |
| Auth mine/saved/deactivated | requise (401) | identique |
| Search vue light | `slots=[]`, `packages=[]`, `is_owner=false` | identique |
| Search limite | `LIMIT 100` | identique |
| Search auto-exclusion | `coach_id != current_user` si JWT valide | identique |
| Detail owner | `coach OR admin` | identique |
| Detail 404 | `{"detail":"Service not found"}` | identique |
| Saved format | plat distinct + `available_slots` | identique |
| Deactivated | champs lifecycle + `days_until_media_purge` | identique |
| Compat SQL test | PostgreSQL `TO_CHAR(NOW(), 'YYYY-MM-DD')` | fallback H2 `CURRENT_DATE` en test uniquement |

## Services coach CRUD writes — slice 43

| Sujet | Python | Java (slice 43) |
|-------|--------|------------------|
| Endpoints | `POST/PUT/PATCH/DELETE /api/services`, `POST /api/services/{id}/reactivate` | identiques |
| Auth/permissions | coach/admin create ; owner/admin update/delete/reactivate | identique |
| 403/404/409 messages asymétriques | anglais/français mélangés selon endpoint | identique |
| Validation 422 create | title min 5, images <= 5, price >= 0 | identique (shape `detail[]`) |
| PUT/PATCH validations faibles | pas de validations POST renforcées | identique (asymétrie conservée) |
| Images update | `null/absent=keep`, `[]=wipe`, liste=diff + suppression immédiate | identique |
| Images delete service | purge différée 90j via `pending_file_deletions` | identique |
| Delete guard bookings | blocage coach, bypass admin | identique |
| Reactivate lifecycle | annule pending, remet actif, garde `media_purged` | identique |
| Booking defaults asymétriques | POST `manual_approval/true/1440`, PUT `instant_booking/false/1440` | identique |
| Slots/packages writes | présents dans payload Python mais traités séparément | **hors scope S43** côté Java (report S44/S45) |
| Transaction | Python sans transaction explicite | Java `@Transactional` (amélioration robuste sans changement d’API) |

## Services slots availability — slice 44

| Sujet | Python | Java (slice 44) |
|-------|--------|------------------|
| Nouveaux endpoints | aucun | aucun |
| Endpoints impactés | `POST/PUT/PATCH /api/services` | identiques, enrichis pour persister `slots[]` |
| Tri-état slots | `null=keep`, `[]=wipe`, `list=replace` | identique |
| slot types write | `recurring`, `single`, `availability` | identique |
| `location_index` | index valide sinon fallback index 0 / null | identique |
| `location_id` direct payload | ignoré | identique |
| `raw_schedule` | accepté mais non persisté | identique |
| Validation stricte horaires/dates | absente | absente (parité conservée) |
| Replace global | `DELETE service_slots WHERE service_id=?` sans garde booking/package | identique |
| `slot_status` insert | non spécifié, default DB `available` | identique (default DB aligné) |
| S42 read round-trip | slots créés/maj visibles via `/services*` | identique |

## Services packages — slice 45

| Sujet | Python | Java (slice 45) |
|-------|--------|------------------|
| Nouveaux endpoints | aucun | aucun |
| Endpoint write package | `POST /api/services` uniquement | identique |
| PUT/PATCH avec `packages` | ignoré silencieusement | identique (no-op) |
| `services.price` create | `data.price` sinon `min(packages.price)` sinon `0.0` | identique |
| Package slots insert | `service_slots` avec `package_id`, `slot_type='single'` literal | identique |
| Package slot `location_id` | toujours `NULL` | identique |
| Validations package-level supplémentaires | absentes (pas de check `price>=0` package) | absentes |
| Replace global S44 | efface aussi slots de packages si `slots=[]/replace` | identique |

## Services save / unsave — slice 46

| Sujet | Python | Java (slice 46) |
|-------|--------|------------------|
| Endpoints | `POST /services/{id}/save`, `DELETE /services/{id}/unsave` | identiques |
| Path asymétrique | `/unsave` (pas `DELETE /save`) | identique |
| Auth | obligatoire sur les 2 routes | identique |
| POST check service | `service_id` existe ET `active=TRUE`, sinon 404 | identique |
| POST idempotence | `INSERT ... ON CONFLICT DO NOTHING` | identique |
| `saved_at` re-save | non modifié | identique |
| DELETE unsave | silent, jamais 404 | identique |
| DELETE filtre active | aucun | identique |
| Réponse JSON | `{success, is_saved}` | identique |

## Notifications inbox — slice 47

| Sujet | Python | Java (slice 47) |
|-------|--------|------------------|
| Endpoints | GET inbox + PATCH read + PATCH read-all | identiques |
| Auth | JWT obligatoire sur les 3 | identique |
| GET `limit` | default 50, range 1..200, hors range 422 | identique |
| GET format | tableau direct (pas d’enveloppe) | identique |
| `data` parsing | null/string/json invalide -> `{}` | identique |
| Override sender picture | remplace `data.sender_picture` si photo actuelle non nulle | identique |
| PATCH single absent/non-owner | silent 200 + unread recalculé | identique |
| PATCH all réponse | `{success:true}` sans `unread_notif` | identique |
| WS broadcast | `notif_manager.notify(...)` | stub no-op `NotifBroadcaster` (différé slice WS) |

## Chat & WebSockets — slice 48

| Sujet | Python | Java (slice 48) |
|-------|--------|------------------|
| REST endpoints chat | 6 routes (`conversations/messages/leave`) | identiques |
| WS endpoints | `/ws/chat/{id}`, `/ws/notifications`, `/ws/spot-you/{id}` | identiques |
| Handshake WS | 1er frame JSON `{token}` sous 5s | identique |
| Close codes | `4001` auth fail, `4003` permission, `4009` too large | identiques |
| Anti-spam WS chat | 500ms silent skip | identique |
| Taille message WS chat | `>8192` bytes UTF-8 -> close `4009` | identique |
| `GET /conversations` enrichissement | batch anti-N+1 (last message, unread, blocked, other/group fields) | identique |
| `GET /messages` | `DESC+LIMIT` puis reverse + mark read + unread push | identique |
| `PUT /conversations/{id}/read` | silent 200 même non-participant | identique |
| `DELETE /messages/{id}` | ordre gardes `404 -> already_deleted -> 403` | identique |
| `PATCH /conversations/{id}/leave` | 404 non-participant, idempotent, archive si 0 actif | identique |
| Push chat | `send_push_to_user(..., store=False)` fire-and-forget | stub no-op (parité comportement API conservée, transport push différé) |

## Stabilisation admin (pré-booking)

| Sujet | Python | Java |
|-------|--------|------|
| Collision `/api/admin/subscriptions` | 2 handlers, premier enregistré actif | Décision figée : référence future unique `payment_routes.py:497` (pas de mapping admin dupliqué à ce stade) |
| Collision `/api/admin/subscription-plans` | 2 handlers, premier enregistré actif (`ORDER BY priority DESC, created_at`) | Décision figée validée : conserver ce tri (ASC implicite sur `created_at`) pour la future implémentation admin |

## Tests automatisés (`mvn test`)

- **Flyway** est **désactivé** sur le profil `test` (H2).
- **Schéma + données** : `test-schema-config.sql` + `test-schema-users.sql` ; données `test-data-config.sql` + `test-data-users.sql` (jeu nominal) ou `test-data-config-defaults.sql` (jeu vide config, via `@TestPropertySource` — sans jeu users).

## Décisions humaines encore ouvertes

1. **Port et base path** derrière un gateway : même hôte que le Python ou domaine dédié ?
2. **Auth filtre global** (`SecurityFilterChain`) à durcir avant les slices booking write/admin.
