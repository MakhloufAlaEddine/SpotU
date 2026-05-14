# SLICE_29_IMPLEMENTED — SpotYou soft-delete / reactivate

Implémentation alignée sur `backend/routes/deletion_routes.py` (l.260–431), avec conservation des asymétries Python et des effets de bord métier.

## Endpoints livrés

| Méthode | Chemin |
|---------|--------|
| DELETE | `/api/tag-points/{pointId}` |
| POST | `/api/tag-points/{pointId}/reactivate` |

## Fichiers principaux

- `modules/spotyou/api/TagPointLifecycleController.java`
- `modules/spotyou/service/TagPointLifecycleService.java`
- `modules/spotyou/infra/TagPointLifecycleRepository.java`
- `modules/spotyou/dto/DeleteTagPointResponse.java`
- `modules/spotyou/dto/ReactivateTagPointResponse.java`
- `db/migration/V3__spotyou_soft_delete_reactivate.sql`

## Tables touchées

- `tag_points` (soft-delete / reactivate)
- `conversations` (`context_deleted` TRUE/FALSE)
- `pending_file_deletions` (schedule / cancel pending)
- `spot_you_members` (destinataires push)
- `notifications` (effets push via `SpotYouPushSideEffectService`)

## Règles critiques reproduites

- Ordre des checks strict : **404 → 409 → 403**.
- Delete :
  - `active=FALSE`, `deleted_at=now`, `deleted_by=caller`, `media_purge_scheduled_at=now+90j`.
  - Marquage conversations `context_deleted=TRUE`.
  - Insertion `pending_file_deletions` pour chaque image non vide.
  - Push `"SpotYou désactivé"` aux membres (hors owner).
- Reactivate :
  - Annulation des suppressions **uniquement** `status='pending'`.
  - `active=TRUE`, reset `deleted_*`, reset scheduling/notif purge, `reactivated_at=now`.
  - Conversations `context_deleted=FALSE`.
  - Push `"SpotYou réactivé 🎉"` aux membres (hors caller, asymétrie Python conservée).
  - `requires_media_reupload = media_purged`.

## Side effects hors transaction

Les push sont déclenchés via un hook **after-commit** (`TransactionSynchronizationManager.registerSynchronization(...afterCommit...)`) puis exécutés en asynchrone via `SpotYouPushSideEffectService`.

## Compat Postgres / H2

- Postgres : `ON CONFLICT DO NOTHING` pour `pending_file_deletions`.
- H2 (tests) : fallback `INSERT ... WHERE NOT EXISTS` pour conserver l’idempotence.

## Tests

- Nouveau : `TagPointLifecycleIntegrationTest` (delete/reactivate nominal, 401/403/404/409, `requires_media_reupload`, cancel pending uniquement).
- Ajustements non-régression jeux de données :
  - `TagPointReadIntegrationTest` (comptages après ajout de fixtures S29)
  - `PublicProfileIntegrationTest` (compte `tag_points`)
- Vérification globale : `mvn test` **vert**.

## Écarts restants

1. Push Expo réel toujours non branché (persist `notifications` uniquement, connu depuis S27).
2. Worker média (purge/notification J+83/J+90) non migré dans cette slice REST ; endpoints S29 écrivent bien les colonnes attendues (`media_purge_*`, `media_purged`, `reactivated_at`).

## Blocages

Aucun.

