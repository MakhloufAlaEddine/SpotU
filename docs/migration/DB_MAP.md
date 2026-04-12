# DB_MAP.md — Cartographie Base de Données SpotU
> Source : migrations 001→017 + lecture des routes SQL. Généré le 2026-04-11.

---

## Tables détectées (28)

---

### `users`
| Colonne | Type | Contrainte / Défaut |
|---------|------|---------------------|
| user_id | TEXT | PK |
| email | TEXT | — |
| password_hash | TEXT | — (NULL si Google OAuth) |
| name | TEXT | NOT NULL |
| role | TEXT | DEFAULT 'user' NOT NULL |
| language | TEXT | DEFAULT 'fr' NOT NULL |
| picture | TEXT | — |
| bio | TEXT | — |
| phone | TEXT | — |
| is_coach_verified | BOOLEAN | DEFAULT false |
| coach_tags | JSONB | DEFAULT '[]' |
| show_phone | BOOLEAN | DEFAULT false NOT NULL |
| show_reviews | BOOLEAN | DEFAULT true NOT NULL |
| iban / bic / iban_name | TEXT | — (données bancaires) |
| stripe_customer_id | TEXT | — |
| stripe_account_id | TEXT | — (Stripe Connect) |
| cover_picture / cover_offset_y / cover_scale | TEXT/FLOAT | — |
| sports_level | TEXT | — |
| goals | JSONB | DEFAULT '[]' |
| user_roles | JSONB | DEFAULT '[]' |
| onboarding_done | BOOLEAN | DEFAULT false |
| deleted_at | TIMESTAMPTZ | NULL = actif |
| deleted_by | TEXT | — |
| anonymized_at | TIMESTAMPTZ | NULL |
| media_purge_scheduled_at | TIMESTAMPTZ | deleted_at + 90j |
| media_purged | BOOLEAN | DEFAULT false |
| media_purged_at | TIMESTAMPTZ | — |
| media_purge_notified_at | TIMESTAMPTZ | — |
| reactivated_at | TIMESTAMPTZ | — |
| created_at / updated_at | TIMESTAMPTZ | DEFAULT now() |

**Enums (TEXT contraint par code, pas CHECK DB) :**
- `role` : `user` | `coach` | `admin`
- `language` : `fr` | `en`

---

### `tag_points` (SpotYous)
| Colonne | Type | Notes |
|---------|------|-------|
| point_id | TEXT | PK |
| user_id | TEXT | FK → users (propriétaire) |
| title | TEXT | NOT NULL |
| description | TEXT | — |
| location | geometry(Point,4326) | PostGIS, X=lng Y=lat |
| precision | TEXT | `exact` \| `100m` \| `1000m` |
| tag_ids | JSONB | Tableau IDs de tags |
| domain_id | TEXT | FK → domains |
| active | BOOLEAN | DEFAULT true |
| is_public | BOOLEAN | DEFAULT true (DÉPRÉCIÉ — migration 013) |
| expires_at | TIMESTAMPTZ | — |
| image_url | TEXT | — (legacy, remplacé par images[0]) |
| images | JSONB | Tableau URLs |
| schedule | TEXT | — (legacy) |
| event_date | TIMESTAMPTZ | Date unique |
| event_end_date | TIMESTAMPTZ | — |
| event_schedule | JSONB | `{type:"weekly", schedule:{dayIdx:[{start,end}]}}` |
| new_date_coming | BOOLEAN | DEFAULT false |
| cancelled | BOOLEAN | DEFAULT false |
| minimum_participants | INTEGER | — |
| maximum_participants | INTEGER | — |
| address | TEXT | — |
| visibility_type | TEXT | `public` \| `private` DEFAULT 'public' (**migration 014**) |
| join_mode | TEXT | `open` \| `admin_approval` \| `members_approval` (**migration 014**) |
| invite_permissions | TEXT | `admin_only` \| `members_only` \| `admin_and_members` (**migration 014**) |
| max_community_members | INTEGER | NULL = illimité |
| deleted_at / deleted_by | TIMESTAMPTZ/TEXT | Soft delete |
| media_purge_* | TIMESTAMPTZ/BOOL | Purge J+90 |
| reactivated_at | TIMESTAMPTZ | — |

**Contraintes DB :** `chk_visibility_type`, `chk_join_mode`, `chk_invite_permissions`

---

### `spot_you_members`
| Colonne | Type | Notes |
|---------|------|-------|
| id | TEXT | PK |
| spot_you_id | TEXT | FK → tag_points.point_id |
| user_id | TEXT | FK → users |
| joined_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| status | TEXT | `pending` \| `accepted` \| `rejected` \| `invited` (**migrations 014/015**) |
| requested_by | TEXT | user_id de l'initiateur |
| approved_by | TEXT | — |
| invited_by | TEXT | FK → users ON DELETE SET NULL (**migration 017**) |
| invited_at | TIMESTAMPTZ | — (**migration 017**) |

**Contrainte unique implicite :** `(spot_you_id, user_id)` — `ON CONFLICT (spot_you_id, user_id) DO UPDATE`
**Index :** `idx_syu_members_status (spot_you_id, status)`, `idx_syu_members_invited (spot_you_id, user_id) WHERE status='invited'`, `idx_syu_members_invited_user (user_id) WHERE status='invited'`

---

### `spot_you_attendance`
| Colonne | Type | Notes |
|---------|------|-------|
| id | TEXT | PK |
| spot_you_id | TEXT | FK → tag_points |
| user_id | TEXT | FK → users |
| session_date | DATE | Date de la session |
| status | TEXT | `going` \| `not_going` CHECK |
| created_at | TIMESTAMPTZ | — |

---

### `services`
| Colonne | Type | Notes |
|---------|------|-------|
| service_id | TEXT | PK |
| user_id | TEXT | FK → users (coach/provider) |
| title | TEXT | NOT NULL |
| description | TEXT | — |
| price | NUMERIC(10,2) | — |
| duration_min | INTEGER | DEFAULT 60 |
| tag_ids | JSONB | — |
| domain_id | TEXT | FK → domains |
| max_participants | INTEGER | DEFAULT 1 |
| images | JSONB | — |
| active | BOOLEAN | DEFAULT true |
| booking_approval_mode | TEXT | `manual_approval` \| `instant_booking` |
| allow_pay_later | BOOLEAN | — |
| pay_later_expiration_minutes | INTEGER | — |
| deleted_at / deleted_by | TIMESTAMPTZ/TEXT | Soft delete |
| media_purge_* | — | Purge J+90 |

---

### `service_locations`
| Colonne | Type |
|---------|------|
| location_id | TEXT PK |
| service_id | TEXT FK → services |
| latitude / longitude | FLOAT |
| precision | TEXT |
| description | TEXT |

---

### `service_slots`
| Colonne | Type | Notes |
|---------|------|-------|
| slot_id | TEXT | PK |
| service_id | TEXT | FK → services |
| slot_type | TEXT | `recurring` \| `single` \| `availability` |
| location_id | TEXT | FK → service_locations |
| raw_schedule | JSONB | — |
| days_of_week | JSONB | — |
| day_of_week | INTEGER | 0-6 CHECK |
| start_time / end_time | TEXT | HH:MM |
| slot_date | DATE | Pour type single |
| status | TEXT | `available` \| `pending` \| `booked` \| `expired` \| `cancelled` \| `completed` |

---

### `service_packages`
| Colonne | Type |
|---------|------|
| package_id | TEXT PK |
| service_id | TEXT FK |
| type_id / type_label | TEXT |
| duration_min | INTEGER |
| max_participants | INTEGER |
| price | NUMERIC |

---

### `bookings`
| Colonne | Type | Notes |
|---------|------|-------|
| booking_id | TEXT | PK |
| service_id | TEXT | FK → services |
| user_id | TEXT | FK → users (payer — alias historique) |
| coach_id | TEXT | FK → users (receiver — alias historique) |
| payer_user_id | TEXT | — (duplique user_id) |
| receiver_user_id | TEXT | — (duplique coach_id) |
| status | TEXT | **Voir enum ci-dessous** |
| scheduled_at | TIMESTAMPTZ | — |
| notes | TEXT | — |
| amount | NUMERIC(10,2) | Montant brut |
| slot_id | TEXT | FK → service_slots |
| location_id | TEXT | FK → service_locations |
| payment_status | TEXT | — |
| payment_provider | TEXT | — |
| payment_intent_id | TEXT | — (Stripe PI ID) |
| pricing_snapshot | JSONB | Snapshot immutable du calcul de frais |
| currency | TEXT | DEFAULT 'EUR' |
| idempotency_key | TEXT | — |
| expires_at | TIMESTAMPTZ | TTL paiement/acceptation |
| cancelled_by_user_id | TEXT | — |
| cancellation_reason | TEXT | — |
| payment_mode | TEXT | `pay_now` \| `pay_later` |

**Enum status :** `requested` | `awaiting_payment` | `confirmed` | `accepted` (legacy) | `refused` | `expired` | `cancelled` | `completed`

---

### `payments`
| Colonne | Type | Notes |
|---------|------|-------|
| payment_id | TEXT | PK |
| payer_user_id | TEXT | NOT NULL |
| receiver_user_id | TEXT | — |
| product_type | TEXT | NOT NULL |
| product_id | TEXT | — |
| booking_id | TEXT | — |
| stripe_payment_intent_id | TEXT | — |
| stripe_charge_id | TEXT | — |
| stripe_transfer_id | TEXT | — |
| stripe_checkout_session_id | TEXT | — |
| status | TEXT | **Voir enum ci-dessous** NOT NULL |
| currency | TEXT | DEFAULT 'EUR' NOT NULL |
| base_amount | NUMERIC(12,2) | NOT NULL |
| payer_fixed_fee | NUMERIC(12,2) | — |
| payer_percent_fee_amount | NUMERIC(12,2) | — |
| receiver_fixed_fee | NUMERIC(12,2) | — |
| receiver_percent_fee_amount | NUMERIC(12,2) | — |
| platform_total_fee | NUMERIC(12,2) | — |
| receiver_net_amount | NUMERIC(12,2) | NOT NULL |
| payer_total_amount | NUMERIC(12,2) | NOT NULL |
| pricing_rule_snapshot | JSONB | Source de vérité immuable |
| refund_amount | NUMERIC(10,2) | DEFAULT 0 |
| refund_status | TEXT | — |

**Enum status :** `requires_authorization` | `authorized` | `capture_pending` | `captured` | `cancelled` | `refunded` | `failed`

---

### `pricing_rules`
| Colonne | Type |
|---------|------|
| rule_id | TEXT PK |
| product_type | TEXT |
| name | TEXT |
| payer_fixed_fee / payer_percent_fee | NUMERIC(10,2) |
| receiver_fixed_fee / receiver_percent_fee | NUMERIC(10,2) |
| active | BOOLEAN |
| priority | INTEGER |

---

### `subscription_plans`
| Colonne | Type |
|---------|------|
| plan_id | TEXT PK |
| name / description | TEXT |
| price | NUMERIC(10,2) |
| duration_days | INTEGER (30 ou 365) |
| exempt_payer_fixed / _percent | BOOLEAN |
| exempt_receiver_fixed / _percent | BOOLEAN |
| active | BOOLEAN |
| priority | INTEGER |
| stripe_product_id / stripe_price_id | TEXT |

---

### `user_subscriptions`
| Colonne | Type | Notes |
|---------|------|-------|
| subscription_id | TEXT | PK |
| user_id | TEXT | FK → users |
| plan_id | TEXT | FK → subscription_plans |
| status | TEXT | `active` \| `cancelling` \| `cancelled` \| `past_due` |
| started_at | TIMESTAMPTZ | — |
| expires_at | TIMESTAMPTZ | NULL = sans fin |
| stripe_subscription_id | TEXT | — |
| stripe_checkout_session_id | TEXT | — |
| benefits_snapshot | JSONB | Snapshot des bénéfices au moment de la souscription |

---

### `conversations`
| Colonne | Type | Notes |
|---------|------|-------|
| conversation_id | TEXT | PK |
| type | TEXT | `service` \| `tagpoint_group` \| `tagpoint_private` CHECK |
| context_id | TEXT | ID du service ou tag_point concerné |
| context_title | TEXT | — |
| created_by | TEXT | — |
| last_message_at | TIMESTAMPTZ | — |
| deleted_at | TIMESTAMPTZ | Soft delete |
| context_deleted | BOOLEAN | DEFAULT false |

---

### `conversation_participants`
| Colonne | Type |
|---------|------|
| conversation_id | TEXT PK |
| user_id | TEXT PK |
| joined_at | TIMESTAMPTZ |
| last_read_at | TIMESTAMPTZ |
| status | TEXT DEFAULT 'active' NOT NULL |

---

### `messages`
| Colonne | Type |
|---------|------|
| message_id | TEXT PK |
| conversation_id | TEXT FK |
| sender_id | TEXT FK → users |
| content | TEXT NOT NULL |
| created_at | TIMESTAMPTZ |
| deleted_at | TIMESTAMPTZ |

---

### `notifications`
| Colonne | Type | Notes |
|---------|------|-------|
| notif_id | TEXT | PK |
| user_id | TEXT | Destinataire |
| type | TEXT | Libre (ex: `join_request`, `booking_confirmed`, ...) |
| title / body | TEXT | Contenu |
| data | JSONB | Payload enrichi |
| read | BOOLEAN | DEFAULT false |
| created_at | TIMESTAMPTZ | — |

---

### `marketplace_products`
| Colonne | Type | Notes |
|---------|------|-------|
| product_id | TEXT | PK |
| title / description | TEXT | — |
| price | NUMERIC(10,2) | NOT NULL |
| product_type | TEXT | `sale` \| `rental` DEFAULT 'sale' |
| seller_type | TEXT | `spotu` DEFAULT 'spotu' |
| seller_id | TEXT | — |
| status | TEXT | `active` \| `inactive` \| `pending_review` \| `deleted` |
| pricing_type | TEXT | `day` |
| pricing_modes | TEXT[] | `{day, hour, week, month, session}` |
| delivery_modes | TEXT[] | — |
| rental_duration_unit | TEXT | — |
| image_url / image_urls | TEXT/JSONB | — |
| lat / lng | FLOAT | — |
| city | TEXT | — |
| location_privacy | TEXT | `100m` (défaut) |
| admin_reminder_sent_at | TIMESTAMPTZ | Anti-doublon rappel admin |
| admin_validated_by / admin_validated_at | TEXT/TIMESTAMPTZ | — |
| rejection_reason / admin_comment | TEXT | — |
| deleted_at / deleted_by | TIMESTAMPTZ/TEXT | Soft delete |
| media_purge_* | — | Purge J+90 |
| stripe_product_id / stripe_price_id | TEXT | — |

---

### `push_tokens`
| Colonne | Type |
|---------|------|
| token_id | TEXT PK |
| user_id | TEXT FK → users |
| token | TEXT UNIQUE |
| platform | TEXT |
| created_at | TIMESTAMPTZ |

---

### `reviews`
| Colonne | Type | Notes |
|---------|------|-------|
| review_id | TEXT | PK |
| booking_id | TEXT | FK → bookings |
| reviewer_id | TEXT | FK → users |
| reviewee_id | TEXT | FK → users |
| rating | INTEGER | CHECK (1-5) |
| comment | TEXT | — |
| created_at | TIMESTAMPTZ | — |

---

### `domains`
| Colonne | Type |
|---------|------|
| domain_id | TEXT PK |
| name | TEXT |
| label_fr / label_en | TEXT |
| icon | TEXT |
| color | TEXT DEFAULT '#1DBF73' |
| active | BOOLEAN |

---

### `tags`
| Colonne | Type |
|---------|------|
| tag_id | TEXT PK |
| category_id | TEXT FK → tag_categories |
| domain_id | TEXT FK → domains |
| name / label_fr / label_en | TEXT |
| icon | TEXT |
| active | BOOLEAN |

---

### `tag_categories`
| Colonne | Type |
|---------|------|
| category_id | TEXT PK |
| domain_id | TEXT FK → domains |
| entity_type | TEXT |
| name / label_fr / label_en | TEXT |
| icon | TEXT |
| active | BOOLEAN |

---

### `tag_category_links` / `tag_entity_type_links`
Tables de liaison tag ↔ catégorie et tag ↔ type d'entité (`spotyou` | `service` | `product`).

---

### `tag_point_saves` / `service_saves`
Saves (favoris) par utilisateur. PK composée (user_id, point_id ou service_id).

---

### `tag_point_votes`
| Colonne | Type |
|---------|------|
| vote_id | TEXT PK |
| point_id | TEXT FK → tag_points |
| user_id | TEXT FK → users |
| rating | INTEGER CHECK (1-5) |
| comment | TEXT |

---

### `user_follows`
PK composée (follower_id, followed_id).

### `user_blocks`
PK composée (blocker_id, blocked_id).

### `user_saved_addresses`
Adresses sauvegardées par utilisateur.

---

### `stripe_webhook_events`
Table d'idempotence Stripe. PK = `event_id` (str Stripe). Protège contre les doubles traitements.

---

### `pending_file_deletions`
| Colonne | Type | Notes |
|---------|------|-------|
| id | TEXT PK |
| entity_id | TEXT | ID de l'entité propriétaire |
| entity_type | TEXT | `tag_point` \| `service` \| `user` \| `product` |
| file_url | TEXT | URL R2 à supprimer |
| status | TEXT | `pending` \| `done` \| `failed` |
| scheduled_at | TIMESTAMPTZ | — |

---

### `app_config`
| Colonne | Type |
|---------|------|
| config_key | TEXT PK |
| config_value | TEXT |
| updated_at | TIMESTAMPTZ |

**Clés connues :** `enable_manual_approval_for_services`, `enable_pay_later_for_services`, `pay_now_checkout_minutes`

---

### `_migrations`
Table interne runner migrations. PK = checksum SHA-256. Contrôle de version.

---

## Relations clés

```
users (1) ──────────────────── (*) tag_points         (user_id = propriétaire)
users (1) ──────────────────── (*) spot_you_members   (user_id = membre)
tag_points (1) ──────────────── (*) spot_you_members  (spot_you_id)
tag_points (1) ──────────────── (*) spot_you_attendance

users (1) ──────────────────── (*) services           (user_id = coach)
services (1) ───────────────── (*) service_slots
services (1) ───────────────── (*) service_locations
services (1) ───────────────── (*) service_packages

users (1) ──────────────────── (*) bookings           (payer_user_id)
services (1) ───────────────── (*) bookings
bookings (1) ───────────────── (1) payments

conversations (1) ──────────── (*) conversation_participants
conversations (1) ──────────── (*) messages

users (1) ──────────────────── (*) notifications
users (1) ──────────────────── (*) user_subscriptions
subscription_plans (1) ──────── (*) user_subscriptions
pricing_rules (0..1) ─────────── computed → payments (via pricing_engine)
```

---

## Incohérences / Zones floues

| Observation | Localisation | Impact migration |
|-------------|-------------|-----------------|
| `bookings.user_id` + `bookings.coach_id` dupliquent `payer_user_id` + `receiver_user_id` | `001_initial_schema.sql`, `booking_routes.py` | Colonnes historiques, les routes lisent les deux — à unifier |
| `tag_points.is_public` toujours stocké mais déprécié par `visibility_type` | migration 013 (DROP) | Colonne supprimée en migration 013, mais encore référencée dans TagPointUpdate (models.py l.197) |
| `spot_you_members.requested_by` vs `invited_by` : deux canaux d'origine distincts | migration 017 | Attention au mapping Spring : cas `requested_by` = NULL si invitation |
| `tag_points.image_url` + `tag_points.images` : doublon (legacy) | `tagpoint_routes.py` `_first_image()` | Lire `images[0]` en priorité, `image_url` en fallback |
| `bookings.amount` = montant brut, `payer_total_amount` dans payment = montant réel payé | — | Les deux colonnes coexistent mais ont des sémantiques différentes |
| `services` n'a pas de colonne `address` directe | `service_routes.py` `_mask_address()` | Adresse déduite des `service_locations` |
| `tag_point_votes.rating` (1-5) ≠ booking reviews `reviews.rating` (1-5) | distinct | Deux tables de notation indépendantes |
