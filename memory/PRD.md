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
│       │   ├── profile.tsx       ← Section "À réactiver" (ReactivatableSection)
│       │   ├── chat.tsx
│       │   └── map.tsx
│       ├── chat/[id].tsx         ← Fix MessageBubble déclaration
│       ├── spot-you/[id].tsx
│       ├── spot-me.tsx
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
│       ├── deletion_routes.py              ← Mis à jour
│       ├── service_routes.py               ← Mis à jour
│       ├── product_creation_routes.py      ← Mis à jour
│       └── tagpoint_routes.py              ← DELETE conflit supprimé
```

---

## Implémenté ✅

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

---

## Règles métier critiques
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
