# ENDPOINTS_RECONCILIATION.md

## Méthodologie

- **Certain** : comptage par AST des décorateurs `@router.*` / `@api_router.*` sur fonctions de module dans les chemins ci-dessus.
- **Déduit** : résolution des collisions par ordre d’inclusion des routers dans `server.py` (comportement « premier match » de Starlette / FastAPI — non exécuté ici).
- **Incertain** : comportement runtime exact sans démarrage app ; document externe « ~70 endpoints » **non présent** dans le dépôt.

## Chiffres clés

| Métrique | Valeur | Certitude |
|----------|--------|----------|
| Décorateurs route totaux (`@router` + `@api_router` sur handlers) | **183** | certain |
| Opérations **HTTP** distinctes (couple méthode + path) | **178** | certain |
| Opérations **WebSocket** distinctes | **3** | certain |
| Paires (méthode, path) en **collision** (≥2 décorateurs) | **2** | certain |
| Alias de chemin (même handler, ≥2 chemins) | **2** handlers (`my_bookings`, `received_bookings`) → **4** chemins | certain |
| Double décorateur (même handler, PUT+PATCH même path) | **1** handler (`update_service`) → **2** méthodes HTTP | certain |

## Écart décorateurs vs endpoints distincts

- Décorateurs : **183**.
- Endpoints distincts (HTTP+WS) : **181** = **181**.
- Écart : **2** = **2** (deux chemins en double : deux paires `(GET,/api/admin/subscription-plans)` et `(GET,/api/admin/subscriptions)` portent chacune **2** décorateurs pour **2** handlers différents).
- Les **alias** booking (4 décorateurs → 4 chemins distincts) et **PUT+PATCH** sur `update_service` (2 décorateurs → 2 lignes dans la liste canonique car **méthodes différentes**) **ne réduisent pas** le nombre d’opérations distinctes au sens `(méthode, path)` ; seules les **2 collisions** réduisent 183 → 181.
- Un décompte « ~70 » correspond plutôt à des **regroupements métier**, des **handlers** uniques, ou une documentation partielle — pas au périmètre `(méthode, path)` exhaustif.

## Rapport avec « ~70 endpoints » (autre analyse)

- Le document **~70** n’est pas versionné dans ce dépôt : comparaison **impossible** de façon exhaustive (**incertain**).
- `migration_audit/ENDPOINTS_INVENTORY.md` compte **~126** paires méthode+path dans ses **tableaux** explicites, alors que le code en expose **178** HTTP : l’écart vient surtout de sections **condensées** (ex. tagpoints, admin « ~30 handlers ») plutôt que d’endpoints absents du code.

## Routes non HTTP détectées (hors décorateurs)

- **`get_spot_you_members`** dans `spot_you_routes.py` (vers ligne 599) : **aucun** `@router` → **non exposé** (certain).
- **`/api/uploads/*`** : `StaticFiles` dans `server.py` (l.239–244) — **fichiers statiques**, pas handler OpenAPI classique (route technique).

## Endpoints « incertains » (cette passe)

- **Auth par heuristique** (colonne *Auth* de `ENDPOINTS_CANONICAL_LIST.md`, analyse du corps du handler, **WS relus** manuellement dans `chat_routes.py`) : sur **181** lignes canoniques, **150** « certain », **5** « déduit », **26** « incertain » (relecture manuelle recommandée pour le reste).
- **Ordre effectif des collisions** : le « gagnant » est **déduit** de l’ordre d’`include_router` + numéro de ligne, **sans** introspection runtime des routes FastAPI (import `server` bloqué par `upload_routes.py` / chemin `/app/...`).

## Résumé chiffré (mission)

| Décorateurs totaux | HTTP distincts | WS distincts | Collisions `(M,P)` | Auth « certain » (lignes) | Auth « incertain » (lignes) |
|--------------------|----------------|--------------|--------------------|-----------------------------|-----------------------------|
| 183 | 178 | 3 | 2 | 150 | 26 |

**Top 3 ambiguïtés** : (1) **2 collisions** admin souscriptions / plans — confirmer le handler réellement invoqué par un test runtime (ordre des routes) ; (2) **chemins fichiers** upload (`/app/backend/uploads` dans `upload_routes.py` vs `ROOT_DIR / "uploads"` monté en `/api/uploads` dans `server.py`) ; (3) **document ~70** non disponible — impossible de dire quels regroupements métier il omet.

