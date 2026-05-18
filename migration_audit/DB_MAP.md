# DB_MAP.md — PostgreSQL (SpotU)

**Source principale** : `backend/migrations/001_initial_schema.sql` (certain) + `backend/migrations/009_pending_file_deletions.sql` (certain).  
**PostGIS** : extension `postgis` requise (certain, migration 001).

---

## 1. Tables détectées

### 1.1 Schéma initial (`001_initial_schema.sql`)

| Table | Rôle (déduit du nom + colonnes migration) |
|-------|-------------------------------------------|
| `app_config` | Clés/valeurs configuration globale (ex. flags réservation). |
| `bookings` | Réservations ; liens `services`, `users`, paiements, créneaux. |
| `conversation_participants` | Membres d’une conversation. |
| `conversations` | Conversations (type contraint : service, tagpoint_group, tagpoint_private). |
| `domains` | Domaines métier (sport, etc.). |
| `marketplace_products` | Produits marketplace / location / vente. |
| `messages` | Messages chat. |
| `notifications` | Notifications in-app. |
| `payments` | Paiements + snapshot pricing + Stripe IDs. |
| `pricing_rules` | Règles de commission / frais par `product_type`. |
| `push_tokens` | Tokens Expo push par utilisateur. |
| `reviews` | Avis (lien booking / users). |
| `service_locations` | Lieux d’offre service. |
| `service_packages` | Forfaits / packs. |
| `service_saves` | Favoris services. |
| `service_slots` | Créneaux. |
| `services` | Offres coach. |
| `spot_you_attendance` | Présence / « going » SpotYou. |
| `spot_you_members` | Membres communauté liés à un `tag_points` (SpotYou). |
| `stripe_webhook_events` | Idempotence webhooks Stripe (`event_id`). |
| `subscription_plans` | Plans d’abonnement. |
| `tag_categories` | Catégories de tags. |
| `tag_category_links` | Liaison catégorie ↔ tag. |
| `tag_entity_type_links` | Liaison tag ↔ type d’entité. |
| `tag_point_saves` | Favoris tag points. |
| `tag_point_votes` | Votes sur tag points. |
| `tag_points` | Points carto / événements / SpotYou. |
| `tags` | Tags. |
| `user_blocks` | Blocages utilisateurs. |
| `user_follows` | Abonnements follower/followed. |
| `user_saved_addresses` | Adresses utilisateur. |
| `user_subscriptions` | Abonnements Stripe utilisateur. |
| `users` | Comptes utilisateurs. |

### 1.2 Migrations ultérieures (extrait)

| Table | Fichier |
|-------|---------|
| `pending_file_deletions` | `009_pending_file_deletions.sql` — files planifiés pour suppression (statuts, `scheduled_at`, etc.). |

**Autres migrations** (`002`–`017`) : colonnes ajoutées/supprimées, index, commentaires, règles SpotYou — **non relues ligne par ligne** pour cet audit → **flou partiel** sur le schéma exact courant vs dump 001 seul.

---

## 2. Relations (FK) — extrait `001_initial_schema.sql` (certain)

- `bookings` → `users` (user, coach), `services`.
- `conversation_participants` → `conversations`, `users` (CASCADE).
- `conversations` → `users` (created_by).
- `marketplace_products` → `users` (seller).
- `messages` → `conversations`, `users`.
- `notifications` → `users` (CASCADE).
- `payments` → `bookings` (SET NULL), `users` payer/receiver.
- `push_tokens` → `users` (CASCADE).
- `reviews` → `bookings`, `users` (reviewer, reviewee).
- `service_*` → chaîne `services` → `users` (coach).
- `spot_you_*` → `tag_points`, `users`.
- `tag_*` → graphe domaines / catégories / tags / points.
- `user_blocks`, `user_follows` → `users`.

Liste complète : grep `ADD CONSTRAINT .*_fkey` dans `001_initial_schema.sql`.

---

## 3. Champs & types notables (certain — échantillon migration)

- Identifiants métier en **`text`** (`user_id`, `booking_id`, etc.) — pas d’UUID natif PostgreSQL partout.
- Montants **`numeric`** ; snapshots **`jsonb`** (`pricing_snapshot`, `pricing_rule_snapshot`, `data` notifications).
- **`tag_points`** : géolocalisation + champs événement / communauté (détail dans SQL).
- **Contrainte CHECK** sur `conversations.type` (valeurs énumérées en texte).

---

## 4. Statuts / enums

### 4.1 Dans `models.py` (Pydantic — certain)

- `UserRole` : user, coach, admin.
- `Language` : fr, en.
- `Precision` : exact, 100m, 1000m.
- `BookingStatus` : requested, awaiting_payment, confirmed, accepted, refused, expired, cancelled, completed.
- `SlotStatus` : available, pending, booked, expired, cancelled, completed.
- `PaymentStatus` : requires_authorization, authorized, capture_pending, captured, cancelled, refunded, failed.

**Décalage possible (flou)** : colonnes SQL `bookings.status` / `payment_status` peuvent contenir des libellés hors enum Pydantic (ex. legacy `pending`) — **à vérifier** par requêtes SQL ou tests.

### 4.2 Dans la base (déduit)

- Statuts texte sur `marketplace_products.status`, `user_subscriptions.status`, `pending_file_deletions.status`, etc. — **liste exhaustive non extraite** ici.

---

## 5. Index & performance

- Fichiers `005_performance_indexes.sql`, `007_*` — **non audités** dans ce document.

---

## 6. Dépendances entre agrégats (vue migration)

```text
users
 ├── services (coach)
 ├── bookings (client / coach / payer)
 ├── payments
 ├── tag_points (owner)
 ├── spot_you_members / attendance
 ├── conversations / messages
 └── marketplace_products (seller)
```

---

## 7. Incertitudes

- Schéma **réel** en production = 001 + toutes migrations appliquées ; sans `pg_dump` live, **écart possible**.
- Usage **MongoDB** (packages `pymongo`/`motor`) : **non confirmé** sur les tables ci-dessus.
