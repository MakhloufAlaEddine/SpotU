# SpotU — Product Requirements Document

## Problème original
Application React Native (Expo Web) + FastAPI + Supabase.
Implémenter une stratégie de rétention et réactivation avancée (Soft Delete 90j) pour profils, SpotYous, services et produits marketplace.

---

## Architecture

```
/app
├── frontend/
│   └── app/
│       ├── (tabs)/
│       │   ├── profile.tsx       ← Cartes stats 3-en-ligne + styles chips corrigés
│       │   ├── chat.tsx
│       │   └── map.tsx
│       ├── chat/[id].tsx         ← Fix MessageBubble déclaration
│       ├── spot-you/[id].tsx     ← Bannière ambre owner désactivé
│       ├── spot-me.tsx           ← 3 tabs: Actifs, Désactivés, Communautés
│       └── products/
│           └── my-products.tsx
├── backend/
│   ├── migrations/
│   │   └── 012_media_purge_retention.sql   ← APPLIQUÉ
│   ├── media_purge_worker.py               ← NOUVEAU (J+90 purge)
│   ├── media_notif_worker.py               ← NOUVEAU (J+83 notif)
│   ├── admin_purge_worker.py
│   ├── push_service.py
│   └── routes/
│       ├── deletion_routes.py              ← Soft delete + notifications membres
│       ├── service_routes.py               ← Mis à jour
│       ├── product_creation_routes.py      ← Mis à jour
│       └── tagpoint_routes.py              ← DELETE conflit supprimé + 404 désactivés
```

---

## Implémenté ✅

### Phase 1 — Règles SpotYou (2026-04-03)
- **Migration 014** : +`visibility_type`, `join_mode`, `invite_permissions`, `max_community_members` dans `tag_points` ; +`status`, `requested_by`, `approved_by` dans `spot_you_members`
- **Backend** : endpoint `join` avec logique complète (public→direct, private+admin_approval→pending, private+members_approval→pending+notif membres)
- **Backend** : `GET /tag-points/{id}/join-requests`, `POST .../members/{uid}/approve`, `POST .../members/{uid}/reject`
- **Backend** : `GET /users/me/pending-requests` (SpotYous où l'utilisateur a une demande en attente)
- **Frontend** : Step 5 "Accès" dans `create.tsx` + composant `StepAcces.tsx`
- **Frontend** : Section "En attente de validation" dans l'onglet Communautés (`spot-me.tsx`)
- **Tests e2e** : 6 tests (R1→R8) + 15 tests additionnels, tous passent ✅
- **Notifications push** : join_request → notif admin/membres ; approved/rejected → notif requester


### Phase 5 — Workers purge (session précédente)
- ExpiryWorker, SpotYouNotifWorker, AdminPurgeWorker

### Phase A — Migration DB 012 (2026-04-02)
- Colonnes `media_purge_scheduled_at`, `media_purged`, `media_purged_at`, `media_purge_notified_at`, `reactivated_at` ajoutées à `users`, `tag_points`, `services`, `marketplace_products`

### Phase B — Backend API rétention 90j (2026-04-02)
- `DELETE /tag-points/{id}` → soft delete + `media_purge_scheduled_at = +90j` + queue `pending_file_deletions` avec `scheduled_at = +90j`
- `POST /tag-points/{id}/reactivate` → restauration + annulation `pending_file_deletions`
- `DELETE /services/{id}` → soft delete + `media_purge_scheduled_at` (remplace suppression physique immédiate)
- `GET /services/deactivated` → liste services désactivés (placé avant `/{id}` pour éviter conflit routing)
- `POST /services/{id}/reactivate`
- `DELETE /products/{id}` → ajoute `deleted_at` + `media_purge_scheduled_at`
- `POST /products/{id}/reactivate`
- `PATCH /users/{id}/deactivate` → désactivation réversible (≠ DELETE RGPD)
- `POST /users/{id}/reactivate` → réactivation profil SANS cascade
- `GET /users/me/reactivatable` → entités désactivées avec `days_until_media_purge`
- Suppression du doublon `DELETE /tag-points/{id}` dans `tagpoint_routes.py`

### Phase C — Workers automatisés (2026-04-02)
- `MediaPurgeWorker` : scan hourly, marque `media_purged=TRUE` à J+90, déclenche purge physique
- `MediaNotifWorker` : notification push à J+83 (7j avant purge), idempotent via `media_purge_notified_at`
- Enregistrés dans `server.py` startup/shutdown

### Phase D — Frontend (2026-04-02)
- `profile.tsx` : section "À réactiver" avec compteur dynamique "Suppression des médias dans XX jours"
- Bouton "Réactiver" par entité avec appel API
- Fix bug préexistant `chat/[id].tsx` : déclaration `function MessageBubble` manquante + `<Bubble>` → `<MessageBubble>`

### Phase E — Soft Delete UI + Tabs (2026-04-02)
- `spot-me.tsx` : 3 tabs (Actifs, Désactivés, Communautés)
- `spot-you/[id].tsx` : bannière ambre owner + protection 404 non-owners pour désactivés
- Endpoints `join`, `vote`, `save` bloqués sur SpotYous désactivés + auto-refresh frontend
- Code `cancel`/`restore` ancien supprimé, notifications membres déplacées vers deactivation
- Fix 500 lors désactivation (import `_first_image` manquant dans `deletion_routes.py`)

### Phase F — Profile cards stats (2026-04-02)
- Cartes Enregistrés / Mes SpotYou / Planning alignées sur une ligne (`flexDirection: 'row'`)
- Styles `actionChips`, `actionChip`, `actionChipAmber`, `actionChipBlue` ajoutés
- Stats colorées dans carte "Mes SpotYou" : actifs (teal), désactivés (amber), communautés (bleu)

### Phase G — SpotYouCard non-owner + Communautés temps réel (2026-04-02)
- `SpotYouCard.tsx` : nouvelles props `onToggleJoin`, `joiningId`, `isMember`, `isOwner`. Section "Rejoindre/Quitter" avec badge "Membre" vert et bouton "Quitter" rouge pour les non-owners.
- `spot-me.tsx` : 2e hook `useSpotYouListLive` branché sur la liste `joined` (stats temps réel communautés). Fonction `toggleJoin` utilisant `ConfirmActionModal` (compatible web, pas d'Alert.alert). Onglet Communautés passe `isLive`, `isOwner=false`, `isMember=true`, `onToggleJoin`, `joiningId`.
- `tagpoint_routes.py` : Fix bug `GET /users/me/events` — calcul `is_owner` corrigé (comparaison user_id). Avant : tous les items avaient `is_owner=False`. Après : les SpotYous créés par l'utilisateur ont `is_owner=True` et sont filtrés de l'onglet Communautés.

---
1. Soft delete = désactivation 90j, médias conservés, réactivation possible
2. Réactivation > 90j (`media_purged=TRUE`) : entité restaurée mais `requires_media_reupload=TRUE`
3. Réactivation profil utilisateur : NE cascade PAS vers SpotYou/services/produits
4. Workers idempotents : skip si `reactivated_at IS NOT NULL AND reactivated_at >= deleted_at`
5. Annulation fichiers : `DELETE FROM pending_file_deletions WHERE entity_id=$1 AND status='pending'`

---

## Backlog (priorité décroissante)

### P1 — En attente
- **Buyer-Side Reservation/Purchase UI** : sélection durée/quantité + calcul prix total
- **SpotYou Timeslot Selection** : sélection créneau lors réservation "per session"

### P2 — Futur
- Réécriture `test_booking_expiry_guard.py` (Règle 3 : leave community annule participations futures)
- **Image Quality Validation** : client-side scoring (résolution, taille, luminosité) avant upload

### P3 — Backlog
- Refactoring `products/create.tsx` en composants plus petits

---

## Tests
- Rapport : `/app/test_reports/iteration_103.json` — 100% backend (22/24 + 2 idempotency-skips)
- Fichier test : `/app/backend/tests/test_retention_90j.py`

## Credentials de test
Voir `/app/memory/test_credentials.md`
