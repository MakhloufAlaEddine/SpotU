# SLICE_06_SCOPE.md — Cadrage de la Slice 06
> Basé sur `user_routes.py:568–613`, `auth_utils.py:86–100`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## Endpoints inclus dans cette slice

| # | Méthode | Chemin Python (prod) | Chemin Java (cible) | Fichier Python | Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/users/{user_id}/followers` | `/api/users/{userId}/followers` | `user_routes.py` | 568–589 |
| 2 | GET | `/api/users/{user_id}/following` | `/api/users/{userId}/following` | `user_routes.py` | 592–613 |

Les deux chemins Java sont identiques aux chemins Python — pas de renommage.

---

## Endpoint explicitement exclu de cette slice (mais proche)

| Endpoint | Raison d'exclusion |
|---|---|
| `DELETE /api/users/{user_id}/followers/{follower_id}` | Action d'écriture (retirer un follower) — Slice 7+ |
| `POST/DELETE /api/users/{user_id}/block` | Blocage utilisateur — Slice 7+ |
| `GET /api/users/{user_id}/suggestions` | Algorithme complexe, tri multi-critères — Slice 7+ |
| `GET /api/users/search` | Recherche textuelle — Slice 7+ |

---

## Auth — détail important

**Les deux endpoints utilisent `get_optional_auth`** (`auth_utils.py:86`) — **pas** `require_auth`.

`get_optional_auth` est une fonction dédiée (différente du try/except inline de Slice 04) :

```python
# auth_utils.py:86–100
async def get_optional_auth(request: Request, pool):
    try:
        token = get_token_from_request(request)
        if not token:
            return None
        payload = decode_jwt(token)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(f"SELECT {USER_FIELDS} FROM users WHERE user_id = $1", payload["user_id"])
        return row_to_dict(row) if row else None
    except Exception:
        return None
```

- Token absent → `None`
- Token invalide/expiré → `None` (exception avalée)
- `user_id` absent de la DB → `None`
- Token valide + user existant → dict des 18 USER_FIELDS

L'impact : si `me = None` alors `me_id = None`, et les champs `is_following_back` / `follows_back` / `is_blocked` sont tous `false` dans la réponse.

---

## Dépendances exactes

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| Table `user_follows` | DB | OUI | Source JOIN + WHERE (followers et following) |
| Table `users` | DB | OUI | JOIN pour nom, photo, rôle |
| Table `user_blocks` | DB | OUI | Subquery EXISTS pour `is_blocked` |
| `get_optional_auth` | Auth | OUI | `auth_utils.py:86` — implique USER_FIELDS et JWT |
| `JwtAuthFilter` | Auth | OPTIONNEL | Lecture optionnelle du token — ne pas bloquer si absent |

---

## Niveau de risque

**FAIBLE.**

- Deux lectures pures, aucune écriture
- Pas de pagination — retourne tout d'un coup
- Logique CASE WHEN SQL inline (pas de calcul applicatif)
- Seul point d'attention : les noms de champs diffèrent entre les deux endpoints (`is_following_back` vs `follows_back`)

---

## Lien avec les slices précédentes

| Slice | Lien |
|---|---|
| Slice 04 (profil public) | Slice 04 retourne `followers_count` / `following_count` en agrégat. Slice 06 retourne les listes détaillées. |
| Slice 05 (follow/unfollow) | Les mutations de Slice 05 font évoluer les listes retournées par Slice 06. |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Noms de champs asymétriques | `followers` retourne `is_following_back`, `following` retourne `follows_back`. Noms différents, logique inversée. Ne pas utiliser le même DTO pour les deux endpoints. |
| P2 | `get_optional_auth` ≠ try/except inline | C'est une vraie fonction dans `auth_utils.py:86`. Java doit reproduire : token absent ou invalide → `meId = null`, pas de 401. |
| P3 | Pas de 404 si user_id inexistant | Si `user_id` n'existe pas → SQL retourne 0 rows (JOIN vide) → HTTP 200 avec `[]`. Pas de vérification d'existence. |
| P4 | Pas de pagination | Toute la liste est retournée sans `limit` ni `offset`. Sur des profils très populaires, cela peut retourner des milliers d'éléments. Ne pas ajouter de pagination — reproduire le comportement Python. |
| P5 | `is_blocked` dans `user_blocks`, pas dans `user_follows` | La table `user_blocks` est lue dans une subquery EXISTS — table séparée avec sa propre PK `(blocker_id, blocked_id)`. |
