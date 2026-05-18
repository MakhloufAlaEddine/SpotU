# RECOMMENDED_CANONICAL_SCOPE.md

## Vérité de migration (scope canonique HTTP/WS)

- **Inclure** : les **181** opérations `(méthode, path)` listées dans `ENDPOINTS_CANONICAL_LIST.md` (178 HTTP + 3 WS), en traitant chaque **collision** comme **une** surface d’API avec un seul handler Spring cible.
- **Inclure (technique)** : `GET/HEAD` (et méthodes autorisées par Starlette) sur **`/api/uploads/{path:path}`** si le parcours fichiers fait partie du périmètre déploiement — hors contrat OpenAPI classique.

## Mettre de côté (hors contrat API métier)

- **`POST /api/upload-image/debug-422`** : debug / diagnostic (`upload_routes.py`).
- **Handlers jamais joignables** en l’état si le « premier match » est confirmé : `subscription_routes.admin_list_plans`, `subscription_routes.admin_list_subscriptions` pour les chemins en collision (garder le code en migration seulement si vous fusionnez la logique).

## Valider manuellement

- Les **~70** endpoints de l’analyse externe (non fournie) : réconcilier avec cette liste.
- Tous les handlers marqués **auth (incertain)** dans la liste canonique.
- **WebSockets** : stratégie équivalente Spring (STOMP vs raw WS) + auth.

## Migrer plus tard

- Refonte des **collisions** après décision produit (quel handler garder).
- Exposition éventuelle de **`get_spot_you_members`** si le produit l’exige (aujourd’hui fonction interne sans route).

