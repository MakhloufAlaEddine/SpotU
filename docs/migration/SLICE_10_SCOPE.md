# SLICE_10_SCOPE.md — Cadrage de la Slice 10
> Basé sur `domain_routes.py:1–376`, `server.py:96`, `001_initial_schema.sql:94–514`.
> Généré le 2026-02-XX.

---

## Justification du choix de cette slice

**Pourquoi les référentiels maintenant ?**

Les Slices 01–09 couvrent la configuration système (01), l'authentification (02), le profil utilisateur (03–04), les relations sociales (05–07), les avis (08) et la lecture des services (09).

Les **référentiels tags/domaines/catégories** sont des données de support omniprésentes :
- utilisés dans les formulaires de création de services, SpotYou, produits marketplace
- utilisés dans les filtres de recherche (`GET /api/services?domain_id=`, `GET /api/services?coach_id=`)
- consommés par `service_routes.py`, `spot_you_routes.py`, `tagpoint_routes.py`

Caractéristiques qui en font la slice idéale pour ce stade :
- **Aucune auth** sur les 3 GET publics → zéro couplage avec la couche JWT
- **Aucun write** → pas de side effects, pas de Stripe, pas d'upload
- **Données statiques** → aucun risque de concurrence ou de conflit
- **Isolés dans un seul fichier** `domain_routes.py` → périmètre parfaitement délimité

---

## Endpoints inclus dans cette slice

| # | Méthode | Chemin Python | Chemin Java (cible) | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/domains` | `/api/domains` | `domain_routes.py` | 11–19 |
| 2 | GET | `/api/tags/categories` | `/api/tags/categories` | `domain_routes.py` | 36–85 |
| 3 | GET | `/api/tags` | `/api/tags` | `domain_routes.py` | 102–140 |

**Note de montage :** `domain_router` est inclus **sans préfixe** dans `server.py:96` → routes directement sous `/api/`.
```python
# server.py:96
api_router.include_router(domain_router, tags=["domains"])
```

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `POST /api/domains` | Auth admin — write — Slice admin |
| `PUT /api/domains/{domain_id}` | Auth admin — write + cascade — Slice admin |
| `DELETE /api/domains/{domain_id}` | Auth admin — write + cascade — Slice admin |
| `GET /api/domains/{domain_id}/usage` | Auth admin — agrégation stats admin — Slice admin |
| `POST /api/tags/categories` | Auth admin — write — Slice admin |
| `PUT /api/tags/categories/{category_id}` | Auth admin — write + cascade — Slice admin |
| `DELETE /api/tags/categories/{category_id}` | Auth admin — Slice admin |
| `GET /api/tags/categories/{category_id}/usage` | Auth admin — stats admin — Slice admin |
| `POST /api/tags` | Auth admin — write + 3 insertions liées — Slice admin |
| `PUT /api/tags/{tag_id}` | Auth admin — Slice admin |
| `DELETE /api/tags/{tag_id}` | Auth admin — Slice admin |
| `GET /api/tags/{tag_id}/usage` | Auth admin — stats admin — Slice admin |

---

## Auth

### Les 3 endpoints GET — AUCUNE AUTH

```python
# domain_routes.py:11-12
@router.get("/domains")
async def get_domains(include_inactive: bool = Query(False)):
    pool = get_pool()
    # Aucun token extrait, aucun get_current_user, aucun require_role
```

Les 3 handlers GET n'importent pas `get_current_user`, `require_role`, ni ne lisent de cookie ou header `Authorization`.

- Pas de 401 possible
- Pas de 403 possible
- Accès totalement public, sans condition

---

## Dépendances exactes

| Dépendance | Type | Endpoint | Détail |
|---|---|---|---|
| Table `domains` | DB | GET /domains | SELECT * (toutes colonnes) |
| Table `tag_categories` | DB | GET /tags/categories | SELECT * (toutes colonnes) |
| Table `tags` | DB | GET /tags/categories + GET /tags | SELECT t.* |
| Table `tag_category_links` | DB | Les deux | JOIN many-to-many tag ↔ catégorie |
| Table `tag_entity_type_links` | DB | GET /tags (si entity_type filter) | JOIN tag ↔ type d'entité |
| `rows_to_list()` | Utilitaire | Les 3 | Sérialisation asyncpg → dict Python |
| `row_to_dict()` | Utilitaire | GET /tags/categories | Conversion individuelle |

---

## Niveau de risque

**FAIBLE.**

Points d'attention :
1. **Groupement Python** dans `GET /api/tags/categories` — le dict `tags_by_category` est construit en Python (pas en SQL). En Java, utiliser un `Map<String, List<TagDto>>` puis composer le résultat final.
2. **3 branches SQL** dans `GET /api/tags` selon combinaison de filtres — reproduire exactement chaque branche.
3. **`include_inactive` public** dans `GET /api/domains` — paramètre sans auth qui peut exposer des domaines inactifs. Comportement Python à reproduire fidèlement (sans ajouter de restriction non présente dans le code).
4. **SELECT *** — le Python retourne toutes les colonnes. Le Java doit mapper exactement les colonnes existantes (voir DB_MAPPING).

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Groupement côté Python, pas côté SQL | `GET /api/tags/categories` exécute 2 requêtes séquentielles (categories, puis tags liés) puis group en Python. En Java, même séquence ou une seule requête avec JOIN + groupement Java. |
| P2 | `DISTINCT t.*` conditionnel | `GET /api/tags` ajoute `DISTINCT` uniquement si `category_id` ou `entity_type` est présent (JOIN crée des doublons). Si filtrage par `domain_id` seul → pas de JOIN, pas de DISTINCT. |
| P3 | `include_inactive=false` par défaut | `GET /api/domains` avec `include_inactive=false` (défaut) → `WHERE active = TRUE`. Avec `include_inactive=true` → SELECT * sans filtre. Ce paramètre est **public** — ne pas ajouter de protection Java. |
| P4 | LIMIT 200 sur GET /tags | `GET /api/tags` a un LIMIT 200 hardcodé. `GET /api/domains` n'a pas de LIMIT. `GET /api/tags/categories` n'a pas de LIMIT. |
| P5 | `tag_ids` dans entity `tags` est absent ici | La table `tags` ne contient pas de colonne JSONB complexe — données purement relationnelles. Pas de parsing JSONB requis (contrairement à services ou tag_points). |
| P6 | Ordre de tri fixe | `GET /api/domains` → `ORDER BY name`. `GET /api/tags/categories` → `ORDER BY tc.name`. `GET /api/tags` → `ORDER BY t.name`. Tris alphabétiques simples. |
