# Audit Suppression SpotU — Dépendances imbriquées
## Date : Février 2026 — Basé sur le code réel en production

---

## 0. Résumé exécutif

SpotU est une application complexe avec **35 tables**, des relations polymorphiques implicites, et un état de suppression actuellement **fragmenté** (soft delete sur services et produits, pas de DELETE sur SpotYou/Users/Conversations/Messages). Une suppression mal gérée peut :
- Violer des FK `NO ACTION` (crash 500 ou 409 en cascade)  
- Laisser des enregistrements orphelins (le bug `pt_demo009` récemment corrigé est un exemple réel)
- Briser l'historique financier (paiements Stripe, bookings)
- Exposer des données personnelles de l'utilisateur supprimé dans les chats et avis

---

## 1. Cartographie complète des dépendances

### 1.1 Schéma des FKs explicites (avec comportement ON DELETE)

```
users (racine)
├── tag_points.user_id                     → NO ACTION  ⚠️
├── services.coach_id                      → NO ACTION  ⚠️
├── marketplace_products.seller_id         → NO ACTION  ⚠️
├── bookings.user_id / .coach_id           → NO ACTION  ⚠️
├── conversations.created_by               → NO ACTION  ⚠️
├── messages.sender_id                     → NO ACTION  ⚠️
├── conversation_participants.user_id      → CASCADE ✅
├── reviews.reviewer_id / .reviewee_id     → NO ACTION  ⚠️
├── spot_you_members.user_id               → CASCADE ✅
├── spot_you_attendance.user_id            → CASCADE ✅
├── notifications.user_id                  → CASCADE ✅
├── push_tokens.user_id                    → CASCADE ✅
├── user_follows (follower/following)      → CASCADE ✅
├── user_blocks (blocker/blocked)          → CASCADE ✅
├── user_saved_addresses.user_id           → CASCADE ✅
├── user_subscriptions.user_id             → CASCADE ✅
├── service_saves.user_id                  → CASCADE ✅
├── tag_point_saves.user_id                → CASCADE ✅
└── tag_point_votes.user_id                → CASCADE ✅

tag_points (SpotYou)
├── spot_you_members.spot_you_id           → CASCADE ✅
├── spot_you_attendance.spot_you_id        → CASCADE ✅
├── tag_point_saves.point_id               → CASCADE ✅
├── tag_point_votes.point_id               → CASCADE ✅
├── conversations.context_id               → AUCUNE FK ⚠️ (polymorphique implicite)
└── marketplace_products.related_spotyou_ids → AUCUNE FK ⚠️ (tableau TEXT[])

services
├── service_locations.service_id           → CASCADE ✅
├── service_packages.service_id            → CASCADE ✅
├── service_slots.service_id               → CASCADE ✅
├── service_saves.service_id               → CASCADE ✅
├── bookings.service_id                    → NO ACTION  ⚠️
└── conversations.context_id               → AUCUNE FK ⚠️ (polymorphique implicite)

marketplace_products
├── (aucun enfant avec FK directe)
├── payments.product_id                    → AUCUNE FK ⚠️
└── notifications.data.product_id          → AUCUNE FK ⚠️ (JSONB)

bookings
├── payments.booking_id                    → SET NULL ✅
├── reviews.booking_id                     → NO ACTION  ⚠️
└── service_slots.slot_id                  → référence implicite dans requêtes

conversations
├── conversation_participants.conversation_id → CASCADE ✅
└── messages.conversation_id               → CASCADE ✅

tags
├── tag_category_links.tag_id              → CASCADE ✅
└── tag_entity_type_links.tag_id           → CASCADE ✅

tag_categories
└── tag_category_links.category_id        → CASCADE ✅

service_locations
└── service_slots.location_id             → SET NULL ✅

service_packages
└── service_slots.package_id              → SET NULL ✅

subscription_plans
└── user_subscriptions.plan_id            → NO ACTION  ⚠️
```

### 1.2 Dépendances implicites (non protégées par FK)

| Relation implicite | Table source | Champ | Cible | Risque |
|---|---|---|---|---|
| SpotYou → Conversation | `conversations` | `context_id` | `tag_points.point_id` | ⚠️ Orphelin si SpotYou supprimé (bug `pt_demo009`) |
| Service → Conversation | `conversations` | `context_id` | `services.service_id` | ⚠️ Orphelin si service supprimé |
| User → Message | `messages` | `sender_id` | `users.user_id` | ⚠️ Texte affiché sans auteur |
| Product → SpotYou | `marketplace_products` | `related_spotyou_ids` | `tag_points.point_id` | ⚠️ IDs morts dans tableau |
| Entity → Tags | `tag_points`, `services`, `marketplace_products` | `tag_ids` (JSONB/TEXT[]) | `tags.tag_id` | ⚠️ Tags supprimés non reflétés |
| User → Tags | `users` | `coach_tags` (JSONB) | `tags.tag_id` | ⚠️ Tags supprimés non reflétés |
| Notification → Expéditeur | `notifications` | `data.sender_id` | `users.user_id` | ⚠️ Photo/nom de l'utilisateur supprimé |
| Notification → Contexte | `notifications` | `data.point_id` | `tag_points.point_id` | ⚠️ Deep link mort |
| Booking → Slot | `bookings` | `slot_id` | `service_slots.slot_id` | ⚠️ Pas de FK |

---

## 2. Classification de chaque relation

### Légende
- **O** = Ownership forte (enfant n'a pas de sens sans parent)
- **F** = Dépendance fonctionnelle
- **H** = Historique à conserver
- **W** = Référence faible nullifiable
- **J** = Donnée jetable supprimable physiquement

| Relation | Type | Justification |
|---|---|---|
| users → tag_points | **O** | Un SpotYou sans créateur n'a plus de responsable |
| users → services | **O** | Un service sans coach ne peut plus être géré |
| users → marketplace_products | **O** | Un produit sans vendeur ne peut plus être modéré/vendu |
| users → bookings (payer/receiver) | **H** | L'historique financier doit rester, même après suppression compte |
| users → conversations (created_by) | **W** | La conversation reste valide sans son créateur |
| users → messages (sender_id) | **H** | Le contenu reste mais l'auteur devient anonyme |
| users → reviews | **H** | Avis conservés mais auteur anonymisé |
| users → notifications | **J** | Supprimables avec cascade |
| users → push_tokens | **J** | Supprimables avec cascade |
| users → follows/blocks | **J** | Supprimables avec cascade |
| users → spot_you_members | **J** | Supprimables (le SpotYou reste) |
| users → spot_you_attendance | **J** | Supprimables avec cascade |
| users → service_saves | **J** | Supprimables avec cascade |
| users → tag_point_saves | **J** | Supprimables avec cascade |
| users → tag_point_votes | **H** | Votes supprimés impactent le rating public |
| tag_points → spot_you_members | **O** | Membres liés à ce SpotYou uniquement |
| tag_points → spot_you_attendance | **O** | Présences liées à ce SpotYou uniquement |
| tag_points → conversations | **F** | La conv de groupe perd son contexte |
| tag_points → marketplace_products (related_ids) | **W** | Référence faible — nullifiable |
| services → service_slots | **O** | Créneaux n'ont pas de sens sans service |
| services → service_packages | **O** | Formules n'ont pas de sens sans service |
| services → service_locations | **O** | Localisations n'ont pas de sens sans service |
| services → bookings | **H** | Historique financier à conserver |
| services → conversations | **F** | La conv de support perd son contexte |
| bookings → payments | **H** | Audit financier obligatoire |
| bookings → reviews | **H** | Avis lié au booking conservé |
| conversations → messages | **O** | Messages n'ont pas de sens sans conversation |
| conversations → participants | **O** | Participation n'a pas de sens sans conversation |
| tags → (tag_ids dans les entités) | **W** | Références implicites, entités restent valides sans ce tag |

---

## 3. Matrice de suppression par entité

| Entité | Recommandation | Condition | Détail |
|---|---|---|---|
| **users** | Suppression logique (`deleted_at`) | Toujours | Anonymisation des champs PII. FK références conservées avec `deleted_at` et nom anonyme. |
| **tag_points (SpotYou)** | Suppression logique (`active=FALSE`) | Toujours | Conversations marquées `context_deleted=TRUE`. Membres notifiés. |
| **services** | Suppression logique (`active=FALSE`) | Déjà implémenté | Conversations marquées. Bookings actifs → blocage suppression. |
| **marketplace_products** | Suppression logique (`status='deleted'`) | Déjà implémenté | Continuer le pattern existant. |
| **bookings** | Interdiction suppression + archivage | Sauf admin | Garder pour audit. Statuts terminaux : `completed`, `refused`, `expired`, `cancelled`. |
| **payments** | Interdiction suppression totale | Toujours | Audit financier + conformité RGPD. |
| **conversations (groupe)** | Suppression logique (`is_deleted=TRUE`) | Si SpotYou supprimé | Messages conservés en lecture seule. |
| **conversations (privée/service)** | Suppression logique | Si demande user | Masquer de la liste, conserver les messages. |
| **messages** | Soft delete individuel (`deleted_at`) | Sur demande user | Remplacer le contenu par "[Message supprimé]", conserver `message_id`. |
| **reviews (tag_point_votes)** | Suppression physique en cascade | Avec le SpotYou | Votes impactant le rating du SpotYou supprimé. |
| **reviews (booking reviews)** | Anonymisation | Si user supprimé | `reviewer_id = NULL`, `reviewer_name = "Utilisateur supprimé"`. |
| **notifications** | Suppression physique avec user | En cascade | Déjà CASCADE en FK. |
| **push_tokens** | Suppression physique avec user | En cascade | Déjà CASCADE en FK. |
| **spot_you_members** | Suppression physique avec SpotYou | En cascade | Déjà CASCADE en FK. |
| **spot_you_attendance** | Suppression physique avec SpotYou/User | En cascade | Déjà CASCADE en FK. |
| **service_saves / tag_point_saves** | Suppression physique avec user/service | En cascade | Déjà CASCADE en FK. |
| **tags / tag_categories / domains** | Interdiction admin si utilisés | Soft delete | `active=FALSE` seulement. Jamais physique si utilisé. |
| **user_follows / user_blocks** | Suppression physique avec user | En cascade | Déjà CASCADE en FK. |
| **user_saved_addresses** | Suppression physique avec user | En cascade | Déjà CASCADE en FK. |
| **user_subscriptions** | Archivage | À l'expiration | Conserver pour audit et facturation. |
| **service_slots** | Cascade avec service | Déjà implémenté | Via FK CASCADE. |
| **service_packages / locations** | Cascade avec service | Déjà implémenté | Via FK CASCADE. |
| **stripe_webhook_events** | Conservation permanente | Toujours | Audit Stripe obligatoire. |
| **pricing_rules** | Soft delete (`active=FALSE`) | Admin seulement | Jamais physique si des bookings l'ont utilisé. |

---

## 4. Politique cible recommandée pour SpotU

### 4.1 Règles globales

| Règle | Entités concernées |
|---|---|
| **Soft delete par défaut** | `users`, `tag_points`, `services`, `marketplace_products`, `conversations`, `messages` |
| **Hard delete permis** | `spot_you_members`, `spot_you_attendance`, `tag_point_saves`, `service_saves`, `user_follows`, `user_blocks`, `user_saved_addresses`, `push_tokens`, `notifications` |
| **Interdiction de suppression** | `bookings`, `payments`, `stripe_webhook_events` |
| **Anonymisation** | PII de `users` après suppression, `messages.sender_id` → NULL + texte générique |
| **Réservé à l'admin** | Suppression d'un utilisateur, suppression forcée d'un service actif avec bookings |

### 4.2 Colonnes standards à ajouter

```sql
-- Sur les entités principales (soft delete)
deleted_at      TIMESTAMPTZ NULL    -- date de suppression logique
deleted_by      TEXT NULL           -- user_id qui a demandé la suppression
deletion_reason TEXT NULL           -- raison (optionnelle)

-- Sur les entités pouvant être archivées
archived_at     TIMESTAMPTZ NULL
archived_by     TEXT NULL

-- Sur les conversations liées à une entité parente supprimée
context_deleted BOOLEAN DEFAULT FALSE  -- parent (SpotYou/service) supprimé

-- Sur les entités dont le parent peut disparaître
is_active       BOOLEAN DEFAULT TRUE   -- remplace les flags actuels disparates
```

### 4.3 Conventions actuelles vs cibles

| Table | Flag actuel | Flag cible |
|---|---|---|
| `tag_points` | `active BOOLEAN` | + `deleted_at`, `deleted_by` |
| `services` | `active BOOLEAN` | + `deleted_at`, `deleted_by` |
| `marketplace_products` | `status TEXT` (`deleted`) | + `deleted_at`, `deleted_by` |
| `users` | Aucun flag de suppression | + `deleted_at`, `anonymized_at` |
| `conversations` | Aucun | + `deleted_at`, `context_deleted` |
| `messages` | Aucun | + `deleted_at` |

---

## 5. Flux métier de suppression imbriquée

### 5.1 Suppression d'un USER

```
GARDE : Si bookings actifs (requested/awaiting_payment/confirmed) en tant que payeur → BLOQUER
         Si services actifs avec bookings futurs en tant que coach → BLOQUER (ou transférer à l'admin)
         Si tag_points actifs avec membres → AVERTIR, laisser l'admin décider

Flux :
1. users.deleted_at = NOW(), users.deleted_by = admin_id
2. Anonymisation PII :
   - users.email = "deleted_{user_id}@deleted.local"
   - users.name = "Utilisateur supprimé"
   - users.phone = NULL, users.bio = NULL, users.picture = NULL
   - users.password_hash = "[DELETED]"
   - users.iban = NULL, users.bic = NULL, users.iban_name = NULL
   - users.stripe_customer_id = NULL, users.stripe_account_id = NULL
3. Cascade automatique (FK déjà en CASCADE) :
   - spot_you_members, spot_you_attendance → supprimés physiquement
   - notifications, push_tokens → supprimés physiquement
   - user_follows, user_blocks → supprimés physiquement
   - user_saved_addresses, service_saves, tag_point_saves, tag_point_votes → supprimés
   - conversation_participants → supprimés (la conv reste)
   - user_subscriptions → supprimés
4. À gérer manuellement (FK NO ACTION) :
   - messages.sender_id = gardé mais nom affiché via JOIN avec "Utilisateur supprimé"
   - reviews → reviewee_id et reviewer_id gardés (le user_id pointe sur la row anonymisée)
   - tag_points → active = FALSE, deleted_at = NOW() (SpotYou de l'utilisateur supprimé)
   - services → active = FALSE, deleted_at = NOW()
   - marketplace_products → status = 'deleted', deleted_at = NOW()
   - bookings → conserver l'historique, pas de modification
   - conversations.created_by → reste tel quel (l'user est anonymisé)
5. Conversations dont TOUS les participants ont quitté → marquer context_deleted = TRUE

VISIBLE APRÈS :
   - Messages : "[De : Utilisateur supprimé] : <contenu>"
   - Bookings : historique complet, noms remplacés
   - Reviews : affichées sans identité

READ ONLY : toutes les entités de cet utilisateur
SUPPRIMÉ PHYSIQUEMENT : PII, tokens, follows, saves, votes
MASQUÉ : dans les listes publiques (profil, services actifs, SpotYou)
```

### 5.2 Suppression d'un SPOTYOU (tag_points)

```
GARDE : Si des bookings de services "session" pointent vers ce SpotYou → AVERTIR
         Si des marketplace_products.related_spotyou_ids contient cet ID → AVERTIR

Flux :
1. tag_points.active = FALSE, tag_points.deleted_at = NOW()
2. Cascade automatique :
   - spot_you_members → supprimés physiquement ✅
   - spot_you_attendance → supprimées physiquement ✅
   - tag_point_saves, tag_point_votes → supprimés physiquement ✅
3. Conversations liées :
   - conversations WHERE type IN ('tagpoint_group', 'tagpoint_private') AND context_id = point_id
   - → context_deleted = TRUE (conversation devient read-only)
   - → context_title gardé tel quel (pour l'historique)
   - → NE PAS supprimer les messages (historique)
4. marketplace_products.related_spotyou_ids :
   - Retirer l'ID du tableau (UPDATE SET related_spotyou_ids = array_remove(related_spotyou_ids, $1))
5. Notifications envoyées à tous les membres avant cascade (via push)
6. Images R2/filesystem → programme de purge différée (pas immédiate)

VISIBLE APRÈS :
   - Conversation : titre = "SpotYou supprimé" (déjà implémenté en frontend)
   - Message historique : lecture seule, plus d'envoi possible

MASQUÉ DES LISTES : carte, recherche, profil créateur public
SUPPRIMÉ PHYSIQUEMENT : members, attendance, saves, votes (cascade)
READ ONLY : conversation de groupe (archived)
GARDE L'HISTORIQUE : messages de la conversation
```

### 5.3 Suppression d'un SERVICE

```
GARDE (BLOQUER) : bookings en statut requested/awaiting_payment/confirmed → REFUSER la suppression
                  Proposer "désactivation" (active=FALSE) seulement

Flux si aucun booking actif :
1. services.active = FALSE, services.deleted_at = NOW()
2. Cascade automatique (FK CASCADE) :
   - service_locations → supprimées ✅
   - service_packages → supprimés ✅
   - service_slots → supprimés ✅ (libération des créneaux réservés → notifier les users concernés)
   - service_saves → supprimés ✅
3. Conversations :
   - conversations WHERE type = 'service' AND context_id = service_id
   - → context_deleted = TRUE (read-only)
4. Bookings passés → conservés, service_title gelé dans pricing_snapshot (déjà fait)
5. Images R2 → purge différée

VISIBLE APRÈS : bookings historiques avec "Service supprimé" comme titre
MASQUÉ DES LISTES : recherche, profil coach
READ ONLY : conversations liées
SUPPRIMÉ PHYSIQUEMENT : slots, locations, packages (cascade)
```

### 5.4 Suppression d'un PRODUIT MARKETPLACE

```
GARDE : Pas de bookings directs actuellement (UI acheteur non implémentée)
         Vérifier payments.product_id → AVERTIR si paiements existants

Flux :
1. marketplace_products.status = 'deleted' (déjà implémenté)
   + marketplace_products.deleted_at = NOW()
2. Retirer de marketplace_products.related_spotyou_ids des SpotYou liés (si référence inverse)
3. Images R2 → purge différée

MASQUÉ : boutiques SpotYou, marketplace global
VISIBLE APRÈS : rien (produit invisible)
GARDE L'HISTORIQUE : payments si présents
```

### 5.5 Suppression d'un CHAT lié à un SpotYou/service

```
NE PAS PERMETTRE la suppression physique côté user.
Flux autorisé (user) :
- Quitter une conversation : conversation_participants.status = 'left'
  (déjà partiellement implémenté avec 'blocked' au leave SpotYou)

Flux autorisé (admin) :
1. conversations.deleted_at = NOW() (soft delete)
2. conversation_participants → supprimés (cascade)
3. messages → cascade ✅ (FK ON DELETE CASCADE)

READ ONLY pour les autres participants si 1 seul quitte
SUPPRIMÉ si tous les participants quittent → scheduled job de purge
```

### 5.6 Suppression d'un MESSAGE

```
User peut supprimer son propre message uniquement :
1. messages.deleted_at = NOW()
2. messages.content = "[Message supprimé]"
3. Conserver : message_id, conversation_id, sender_id, created_at (pour la chronologie)

Admin peut supprimer tout message :
1. Si contenu abusif → même flux + flag reason

VISIBLE : "[Message supprimé]" à la place du contenu
SUPPRIMÉ PHYSIQUEMENT : jamais (sauf purge admin des conversations > 1 an)
```

### 5.7 Suppression d'une PARTICIPATION/RÉSERVATION

```
Participation SpotYou (spot_you_members) :
- Quitter = DELETE physique (déjà implémenté)
- Le propriétaire ne peut PAS quitter (déjà gardé)
- Cascade : spot_you_attendance futures supprimées

Réservation (bookings) :
- JAMAIS supprimée physiquement
- Cancel → status='cancelled' (déjà implémenté)
- Le booking reste visible dans l'historique des deux parties

Assiduité (spot_you_attendance) :
- User peut retirer sa présence → DELETE physique (déjà implémenté)
- Si SpotYou supprimé → CASCADE
```

### 5.8 Suppression d'un MÉDIA/UPLOAD

```
Images R2/filesystem :
- Suppression immédiate si liée à un champ modifié (déjà implémenté dans services/tag_points)
- Suppression différée (purge job) si liée à entité soft-deleted

Stratégie :
1. À la mise à jour : delete_upload_files(anciens_urls_retirés) — déjà implémenté
2. À la suppression douce de l'entité : marquer les URLs dans une table `pending_delete_files`
3. Job de purge quotidien : supprimer les fichiers de la liste + de R2/filesystem

Table à créer :
CREATE TABLE pending_file_deletions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_url TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL
);
```

---

## 6. Proposition de modèle de données

### 6.1 Migrations SQL proposées

#### Migration 008 — Colonnes soft delete sur entités principales

```sql
-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ NULL;

-- tag_points (SpotYou) — active déjà présent
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

-- services — active déjà présent
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

-- marketplace_products — status='deleted' déjà implémenté
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS deleted_by TEXT NULL;

-- conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS context_deleted BOOLEAN DEFAULT FALSE;

-- messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Indexes de performance sur les nouvelles colonnes
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tag_points_deleted ON tag_points(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_deleted ON services(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_context_deleted ON conversations(context_deleted) WHERE context_deleted = TRUE;
```

#### Migration 009 — Table pending_file_deletions

```sql
CREATE TABLE IF NOT EXISTS pending_file_deletions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    file_url TEXT NOT NULL,
    entity_type TEXT NOT NULL,  -- 'tag_point', 'service', 'product', 'user'
    entity_id TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_deletions_unprocessed
    ON pending_file_deletions(scheduled_at) WHERE processed_at IS NULL;
```

#### Migration 010 — Contrainte softdelete sur users (FK polymorphique)

```sql
-- Ajouter ON DELETE SET NULL sur les références users sans action actuelle
-- (nécessite DROP + RECREATE des FKs existantes)

-- messages.sender_id : autoriser NULL pour les utilisateurs supprimés
ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;

-- Recréer la FK avec SET NULL
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- reviews : autoriser NULL pour reviewer_id / reviewee_id
ALTER TABLE reviews ALTER COLUMN reviewer_id DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN reviewee_id DROP NOT NULL;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewer_id_fkey;
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewee_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewee_id_fkey
    FOREIGN KEY (reviewee_id) REFERENCES users(user_id) ON DELETE SET NULL;

-- Ajouter colonne anonymization dans reviews
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name_snapshot TEXT NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewee_name_snapshot TEXT NULL;
```

---

## 7. Contraintes backend

### 7.1 Filtres par défaut à ajouter sur toutes les requêtes

```python
# users : exclure les comptes supprimés
WHERE users.deleted_at IS NULL

# tag_points : déjà filtré sur active=TRUE — ajouter deleted_at
WHERE tag_points.active = TRUE AND tag_points.deleted_at IS NULL

# services : déjà filtré sur active=TRUE — ajouter deleted_at  
WHERE services.active = TRUE AND services.deleted_at IS NULL

# marketplace_products : déjà filtré status != 'deleted'
WHERE marketplace_products.status != 'deleted'

# conversations : filtrer supprimées
WHERE conversations.deleted_at IS NULL

# messages : filtrer le contenu supprimé (afficher placeholder)
CASE WHEN messages.deleted_at IS NOT NULL THEN '[Message supprimé]' ELSE messages.content END AS content
```

### 7.2 Guards API à implémenter

```python
# Guard suppression service avec bookings actifs
async def _check_no_active_bookings(conn, service_id: str):
    count = await conn.fetchval(
        """SELECT COUNT(*) FROM bookings
           WHERE service_id = $1
             AND status IN ('requested', 'awaiting_payment', 'confirmed', 'accepted')""",
        service_id
    )
    if count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Impossible de supprimer : {count} réservation(s) active(s). "
                   "Annulez-les d'abord ou désactivez le service."
        )

# Guard suppression user avec bookings actifs
async def _check_user_no_active_bookings(conn, user_id: str):
    count = await conn.fetchval(
        """SELECT COUNT(*) FROM bookings
           WHERE (user_id = $1 OR coach_id = $1)
             AND status IN ('requested', 'awaiting_payment', 'confirmed', 'accepted')""",
        user_id
    )
    if count > 0:
        raise HTTPException(409, f"{count} réservation(s) active(s) en cours.")

# Guard suppression tag/catégorie si utilisés
async def _check_tag_not_in_use(conn, tag_id: str):
    used = await conn.fetchval(
        """SELECT EXISTS(
            SELECT 1 FROM tag_points WHERE tag_ids @> $1::jsonb
            UNION ALL
            SELECT 1 FROM services WHERE tag_ids @> $1::jsonb
            UNION ALL
            SELECT 1 FROM marketplace_products WHERE $2 = ANY(tag_ids)
        )""",
        f'["{tag_id}"]', tag_id
    )
    if used:
        raise HTTPException(409, "Ce tag est utilisé par des entités actives. Désactivez-le uniquement.")
```

### 7.3 Endpoint DELETE /users/{user_id} (à créer)

```python
@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    user = await require_auth(request, pool)
    if user["role"] != "admin" and user["user_id"] != user_id:
        raise HTTPException(403, "Accès refusé")
    
    # Guard bookings actifs
    await _check_user_no_active_bookings(conn, user_id)
    
    # Soft delete + anonymisation dans une transaction
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Anonymiser les PII
            await conn.execute("""
                UPDATE users SET
                    email = 'deleted_' || user_id || '@deleted.local',
                    name = 'Utilisateur supprimé',
                    phone = NULL, bio = NULL, picture = NULL,
                    password_hash = '[DELETED]',
                    iban = NULL, bic = NULL, iban_name = NULL,
                    stripe_customer_id = NULL, stripe_account_id = NULL,
                    deleted_at = NOW(), deleted_by = $2,
                    updated_at = NOW()
                WHERE user_id = $1
            """, user_id, user["user_id"])
            
            # 2. Désactiver SpotYou
            await conn.execute("""
                UPDATE tag_points SET active = FALSE, deleted_at = NOW()
                WHERE user_id = $1 AND active = TRUE
            """, user_id)
            
            # 3. Désactiver services
            await conn.execute("""
                UPDATE services SET active = FALSE, deleted_at = NOW()
                WHERE coach_id = $1 AND active = TRUE
            """, user_id)
            
            # 4. Soft delete produits
            await conn.execute("""
                UPDATE marketplace_products SET status = 'deleted', deleted_at = NOW()
                WHERE seller_id = $1 AND status != 'deleted'
            """, user_id)
            
            # 5. Marquer conversations context_deleted pour les convs de groupe de ses SpotYou
            await conn.execute("""
                UPDATE conversations c SET context_deleted = TRUE
                WHERE c.type = 'tagpoint_group'
                  AND EXISTS (
                    SELECT 1 FROM tag_points tp
                    WHERE tp.point_id = c.context_id AND tp.user_id = $1
                  )
            """, user_id)
            
            # 6. Snapshot des noms dans les reviews
            await conn.execute("""
                UPDATE reviews SET reviewer_name_snapshot = (
                    SELECT name FROM users WHERE user_id = reviews.reviewer_id
                )
                WHERE reviewer_id = $1 AND reviewer_name_snapshot IS NULL
            """, user_id)
            
    # Les cascades FK (notifications, tokens, follows, etc.) se font automatiquement
    return {"deleted": True, "user_id": user_id}
```

### 7.4 Modification DELETE /tag-points/{point_id} (à créer)

```python
@router.delete("/tag-points/{point_id}")
async def delete_tag_point(point_id: str, request: Request):
    # Garde : propriétaire seulement ou admin
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Soft delete
            await conn.execute("""
                UPDATE tag_points SET active = FALSE, deleted_at = NOW(), deleted_by = $2
                WHERE point_id = $1
            """, point_id, user["user_id"])
            
            # 2. Marquer les conversations liées comme context_deleted
            await conn.execute("""
                UPDATE conversations SET context_deleted = TRUE
                WHERE context_id = $1 AND type IN ('tagpoint_group', 'tagpoint_private')
            """, point_id)
            
            # 3. Retirer de related_spotyou_ids dans les produits
            await conn.execute("""
                UPDATE marketplace_products
                SET related_spotyou_ids = array_remove(related_spotyou_ids, $1)
                WHERE $1 = ANY(related_spotyou_ids)
            """, point_id)
            
            # 4. Planifier suppression des images
            # (insert dans pending_file_deletions)
```

### 7.5 Job de purge physique différée (à créer)

```python
# admin_purge_worker.py — à exécuter hebdomadairement
async def purge_deleted_entities():
    """
    Purge physique des entités soft-deleted depuis > 30 jours :
    - tag_points.deleted_at < NOW() - 30 days → DELETE
    - services.deleted_at < NOW() - 30 days → DELETE (cascade nettoie slots/packages/locations)
    - users.deleted_at < NOW() - 90 jours → vérifier aucune FK bloquante restante
    - marketplace_products.deleted_at < NOW() - 30 days → DELETE
    
    Et purge des fichiers :
    - pending_file_deletions WHERE processed_at IS NULL AND scheduled_at < NOW() - 1 day
      → delete de R2 + mark processed_at = NOW()
    """
```

---

## 8. Contraintes mobile / frontend

### 8.1 Filtres dans les listes

| Écran | Filtre à appliquer |
|---|---|
| Map (`map.tsx`) | `tag_points.active = TRUE` — déjà filtré par l'API |
| Recherche services (`search.tsx`) | `services.active = TRUE` — déjà filtré |
| Marketplace (`marketplace/[spotYouId].tsx`) | `status != 'deleted'` — déjà filtré |
| Mes SpotYou (`spot-me.tsx`) | Filtrer `deleted_at IS NULL` côté API |
| Mes services (`profile.tsx`) | `active = TRUE` — déjà filtré |
| Mes produits (`products/my-products.tsx`) | `status != 'deleted'` — déjà filtré |
| Chat list (`chat.tsx`) | Afficher `context_deleted=TRUE` convs avec label spécial — PARTIELLEMENT FAIT |

### 8.2 Écrans à passer en read-only

| Condition | Écran | Comportement |
|---|---|---|
| `tag_points.active = FALSE` | `spot-you/[id].tsx` | Bannière "SpotYou supprimé", désactiver boutons Rejoindre/Participer |
| `services.active = FALSE` | `service/[id].tsx` | Bannière "Service désactivé", cacher bouton Réserver |
| `marketplace_products.status = 'deleted'` | `marketplace/product-detail.tsx` | Bannière "Produit indisponible", cacher CTA |
| `conversations.context_deleted = TRUE` | `chat/[id].tsx` | Bannière "Ce chat n'est plus actif", désactiver l'input de message |
| `messages.deleted_at IS NOT NULL` | `chat/[id].tsx` | Afficher "[Message supprimé]" en italique gris |
| `users.deleted_at IS NOT NULL` | `user/[id].tsx` | Afficher "Compte supprimé", profil vide |

### 8.3 Deep links vers un parent supprimé

```typescript
// Pattern à appliquer dans chaque écran de détail
useEffect(() => {
  if (data?.deleted_at || data?.active === false || data?.status === 'deleted') {
    // Option 1 : Afficher un écran "Contenu indisponible" (pas de crash)
    setIsDeleted(true);
    // Option 2 : Rediriger vers la liste parente
    router.replace('/');
  }
}, [data]);
```

### 8.4 Chat list — améliorations (suite du bug pt_demo009)

```typescript
// ConvItem — étendre le fallback existant
const getContextTitle = (conv: Conversation) => {
  if (conv.context_deleted) return "SpotYou supprimé"; // Déjà implémenté partiellement
  if (!conv.context_title) return "Conversation";
  // Détecter les IDs bruts (pt_xxx, svc_xxx) — déjà implémenté
  if (/^(pt_|svc_)\w+$/.test(conv.context_title)) return "Contenu supprimé";
  return conv.context_title;
};

const isChatReadOnly = (conv: Conversation) => {
  return conv.context_deleted === true;
};
```

---

## 9. Plan d'implémentation

### Phase 1 — Sécurité immédiate (P0, 1-2 jours)
**Sans migration ni breaking change**

1. ✅ **Déjà fait** : `context_title` fallback dans `chat.tsx` et `GET /conversations`
2. Ajouter `context_deleted` dans `GET /conversations` en détectant les context_id orphelins
3. Bloquer la suppression physique accidentelle dans `DELETE /tag-points/{id}` (si l'endpoint existait)
4. Ajouter guards bookings actifs dans `DELETE /services/{id}` (actuellement juste soft delete sans garde)

**Fichiers à modifier** :
- `backend/routes/chat_routes.py` — ajouter détection `context_deleted` 
- `backend/routes/service_routes.py` — ajouter garde avant soft delete
- `frontend/app/(tabs)/chat.tsx` — utiliser `context_deleted` pour read-only

### Phase 2 — Migrations DB (P1, 2-3 jours)
**Migration 008** : Colonnes soft delete  
**Migration 009** : Table pending_file_deletions  
**Migration 010** : FKs sender_id/reviewer_id → SET NULL  

### Phase 3 — Endpoints de suppression (P1, 3-5 jours)
1. `DELETE /api/users/{user_id}` (admin + self) — avec anonymisation
2. `DELETE /api/tag-points/{point_id}` — soft delete + nettoyage conversations
3. `DELETE /api/messages/{message_id}` — soft delete contenu
4. `PATCH /api/conversations/{conv_id}/leave` — statut 'left'

### Phase 4 — Frontend read-only states (P2, 2-3 jours)
1. Bannières "contenu supprimé" sur tous les écrans de détail
2. Input chat désactivé si `context_deleted = TRUE`
3. Gestion deep links morts
4. Messages supprimés affichés en italique

### Phase 5 — Purge différée (P3, 1-2 jours)
1. Worker `admin_purge_worker.py` — purge images + entités > 30/90 jours
2. Endpoint admin `/api/admin/purge` pour déclencher manuellement

### Ordre d'implémentation recommandé

```
Phase 1 → tests unitaires FK + garde bookings
Phase 2 (migration 008) → tests d'intégration soft delete
Phase 2 (migration 010) → tests SET NULL cascade
Phase 3 (DELETE users) → tests RGPD anonymisation + zéro crash
Phase 3 (DELETE tag_points) → tests conversation context_deleted
Phase 4 → tests frontend read-only
Phase 5 → tests purge différée
```

### Risques de régression

| Risque | Probabilité | Mitigation |
|---|---|---|
| Migration 010 (FK SET NULL) casse les JOINs | Moyen | Ajouter COALESCE dans toutes les queries qui JOINent users via sender_id/reviewer_id |
| Purge physique des tag_points casse bookings existants | Faible | Ne jamais purger un tag_point avec bookings actifs liés (via service sessions) |
| context_deleted = TRUE sans cache invalidation → affichage stale | Moyen | Invalider le cache `GET /conversations` dès qu'un SpotYou est supprimé |
| Anonymisation user ne propagée pas aux convs | Faible | JOIN dynamique depuis users — déjà fait pour les messages |

---

## A. Tableau complet des dépendances

| Entité parent | Entité enfant | Type relation | FK | ON DELETE | Risque |
|---|---|---|---|---|---|
| users | tag_points | Ownership | Oui | NO ACTION | 🔴 CRITIQUE |
| users | services | Ownership | Oui | NO ACTION | 🔴 CRITIQUE |
| users | marketplace_products | Ownership | Oui | NO ACTION | 🔴 CRITIQUE |
| users | bookings (payer/coach) | Historique | Oui | NO ACTION | 🟡 Moyen |
| users | conversations (created_by) | Référence faible | Oui | NO ACTION | 🟢 Faible |
| users | messages (sender_id) | Référence | Oui | NO ACTION | 🟡 Moyen |
| users | reviews | Historique | Oui | NO ACTION | 🟡 Moyen |
| users | notifications | Jetable | Oui | CASCADE | ✅ OK |
| users | push_tokens | Jetable | Oui | CASCADE | ✅ OK |
| users | spot_you_members | Jetable | Oui | CASCADE | ✅ OK |
| users | spot_you_attendance | Jetable | Oui | CASCADE | ✅ OK |
| users | user_follows | Jetable | Oui | CASCADE | ✅ OK |
| users | user_blocks | Jetable | Oui | CASCADE | ✅ OK |
| users | service_saves | Jetable | Oui | CASCADE | ✅ OK |
| users | tag_point_saves | Jetable | Oui | CASCADE | ✅ OK |
| users | tag_point_votes | Impact rating | Oui | CASCADE | 🟡 Moyen |
| users | conversation_participants | Jetable | Oui | CASCADE | ✅ OK |
| users | user_saved_addresses | Jetable | Oui | CASCADE | ✅ OK |
| users | user_subscriptions | Historique | Oui | CASCADE | 🟡 Moyen |
| tag_points | spot_you_members | Ownership | Oui | CASCADE | ✅ OK |
| tag_points | spot_you_attendance | Ownership | Oui | CASCADE | ✅ OK |
| tag_points | tag_point_saves | Jetable | Oui | CASCADE | ✅ OK |
| tag_points | tag_point_votes | Ownership | Oui | CASCADE | ✅ OK |
| tag_points | conversations.context_id | Fonctionnel | NON | — | 🔴 CRITIQUE |
| tag_points | marketplace_products.related_ids | Référence faible | NON | — | 🟡 Moyen |
| services | service_locations | Ownership | Oui | CASCADE | ✅ OK |
| services | service_packages | Ownership | Oui | CASCADE | ✅ OK |
| services | service_slots | Ownership | Oui | CASCADE | ✅ OK |
| services | service_saves | Jetable | Oui | CASCADE | ✅ OK |
| services | bookings | Historique | Oui | NO ACTION | 🔴 CRITIQUE |
| services | conversations.context_id | Fonctionnel | NON | — | 🟡 Moyen |
| bookings | payments | Historique | Oui | SET NULL | 🟡 Moyen |
| bookings | reviews | Historique | Oui | NO ACTION | 🟡 Moyen |
| conversations | messages | Ownership | Oui | CASCADE | ✅ OK |
| conversations | conversation_participants | Ownership | Oui | CASCADE | ✅ OK |
| tags | tag_category_links | Ownership | Oui | CASCADE | ✅ OK |
| tags | tag_entity_type_links | Ownership | Oui | CASCADE | ✅ OK |

---

## B. Matrice de décision par entité (résumé)

| Entité | Stratégie | Qui peut supprimer | Blocage si |
|---|---|---|---|
| `users` | Soft delete + anonymisation | Admin (+ self RGPD) | Bookings actifs |
| `tag_points` | Soft delete (`active=FALSE`) | Owner + Admin | — |
| `services` | Soft delete (`active=FALSE`) | Coach owner + Admin | Bookings actifs |
| `marketplace_products` | Soft delete (`status='deleted'`) | Seller + Admin | Paiements en cours |
| `bookings` | **INTERDIT** | Admin uniquement pour annulation | Toujours |
| `payments` | **INTERDIT** | Personne | Toujours |
| `conversations` | Soft delete | Admin | — |
| `messages` | Soft delete (contenu remplacé) | Auteur + Admin | — |
| `reviews` | Anonymisation si user supprimé | Admin | — |
| `tags` | Soft delete (`active=FALSE`) | Admin | Utilisés par des entités actives |
| `tag_categories` | Soft delete (`active=FALSE`) | Admin | Catégories utilisées |
| `domains` | Soft delete (`active=FALSE`) | Admin | Domaines utilisés |
| `notifications` | Hard delete | User (via CASCADE) | — |
| `spot_you_members` | Hard delete | User (self) | Owner |
| `spot_you_attendance` | Hard delete | User (self) | — |
| `service_slots` | Hard delete (cascade service) | Via service | Booking actif sur ce slot |
| `user_subscriptions` | Archivage | Admin | — |
| `stripe_webhook_events` | **INTERDIT** | Personne | Toujours |
| `push_tokens` | Hard delete | Via CASCADE user | — |

---

## C. Recommandation finale SpotU

### Priorité immédiate (avant prod)
1. **Ajouter la migration 010** (FK sender_id → SET NULL) pour éviter les crashs si un user est un jour supprimé
2. **Ne jamais supprimer physiquement** users, bookings, payments, services, tag_points
3. **Implémenter `DELETE /api/users/{id}`** avec anonymisation RGPD complète
4. **Implémenter `DELETE /api/tag-points/{id}`** avec nettoyage conversation context_id

### Pattern global recommandé
```
SOFT DELETE = La règle par défaut sur toutes les entités métier
HARD DELETE = Réservé aux données de session/préférences (follows, saves, tokens)
INTERDICTION = Données financières (bookings, payments, stripe events)
ANONYMISATION = PII des users supprimés
```

### Ce qui est déjà en place (bien)
- `services` : soft delete (`active=FALSE`) ✅
- `marketplace_products` : soft delete (`status='deleted'`) ✅
- `conversation_participants` : soft status (`blocked`) ✅
- `tag_points` : cancel soft (`cancelled=TRUE`) ✅
- Images : purge à la mise à jour ✅
- Chat list : fallback "SpotYou supprimé" ✅

### Ce qui manque (critique)
- ❌ Aucune suppression/anonymisation user disponible
- ❌ Aucune colonne `deleted_at` sur users/tag_points/services
- ❌ FK `messages.sender_id → NO ACTION` (crash si user physiquement supprimé)
- ❌ FK `bookings.service_id → NO ACTION` (crash si service physiquement supprimé)
- ❌ FK `conversations.context_id` → polymorphique, sans FK réelle (bug connu)
- ❌ Aucun endpoint `DELETE /tag-points/{id}` (soft delete)
- ❌ Pas de job de purge des fichiers différée

---

*Audit généré par analyse statique du code source réel. Toutes les FKs, routes, et dépendances ont été vérifiées directement dans la base de migrations et les fichiers routes.*
