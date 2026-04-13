# SLICE_05_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `user_routes.py:494–522`.
> Généré le 2026-02-XX.

---

## ENDPOINT 1 — POST /api/users/{user_id}/follow

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `POST` |
| Chemin Python | `/api/users/{user_id}/follow` |
| Chemin Java cible | `/api/users/{userId}/follow` |
| Auth requise | **OUI** — JWT Bearer obligatoire |
| Idempotent | **OUI** — double follow = silencieux (ON CONFLICT DO NOTHING) |
| Effect | Insère une ligne dans `user_follows` |
| Handler Python | `follow_user()` — `user_routes.py:494–509` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | ID de l'utilisateur à suivre, format `"user_<hex12>"` |

### Body / Query Params

**Aucun.** Requête sans corps.

### Réponse — HTTP 200 (follow réussi ou déjà existant)

```json
{
  "is_following": true,
  "followers_count": 149
}
```

| Champ | Type JSON | Type Java | Note |
|---|---|---|---|
| `is_following` | `boolean` | `boolean` | Toujours `true` pour ce endpoint |
| `followers_count` | `number` | `int` | Nombre actuel de followers de la cible après l'opération |

### Codes d'erreur

| Code HTTP | Condition | Corps | Source Python |
|---|---|---|---|
| `400` | Self-follow (`me["user_id"] == user_id`) | `{"detail": "Vous ne pouvez pas vous suivre vous-même."}` | `user_routes.py:498–499` |
| `401` | Token absent / invalide / expiré | `{"detail": "Not authenticated"}` / `"Invalid token"` / `"Token expired"` | `require_auth` |
| `404` | `user_id` cible inexistant en DB | `{"detail": "Utilisateur introuvable."}` | `user_routes.py:502–503` |

### Comportement idempotent — détail

```python
# user_routes.py:504–506
await conn.execute(
    "INSERT INTO user_follows(follower_id, following_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    me["user_id"], user_id
)
```

- Si la relation existe déjà → `ON CONFLICT DO NOTHING` → 0 row inserted → pas d'erreur
- `followers_count` est recalculé depuis DB → retourne le vrai total
- Réponse identique que ce soit un nouveau follow ou un double follow

---

## ENDPOINT 2 — DELETE /api/users/{user_id}/follow

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `DELETE` |
| Chemin Python | `/api/users/{user_id}/follow` |
| Chemin Java cible | `/api/users/{userId}/follow` |
| Auth requise | **OUI** — JWT Bearer obligatoire |
| Idempotent | **OUI** — unfollow inexistant = silencieux (DELETE 0 rows) |
| Effect | Supprime une ligne de `user_follows` |
| Handler Python | `unfollow_user()` — `user_routes.py:512–522` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | ID de l'utilisateur à ne plus suivre |

### Body / Query Params

**Aucun.** Requête sans corps.

### Réponse — HTTP 200 (unfollow réussi ou relation inexistante)

```json
{
  "is_following": false,
  "followers_count": 148
}
```

| Champ | Type JSON | Type Java | Note |
|---|---|---|---|
| `is_following` | `boolean` | `boolean` | Toujours `false` pour ce endpoint |
| `followers_count` | `number` | `int` | Nombre actuel de followers de la cible après l'opération |

### Codes d'erreur

| Code HTTP | Condition | Corps | Source Python |
|---|---|---|---|
| `401` | Token absent / invalide / expiré | `{"detail": "Not authenticated"}` / etc. | `require_auth` |

**Note critique :** Il n'y a PAS de 404 pour unfollow. Que la relation existe ou non, et même
si le `user_id` cible n'existe pas en DB, la réponse est toujours HTTP 200.

### Comportement idempotent — détail

```python
# user_routes.py:517–519
await conn.execute(
    "DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2",
    me["user_id"], user_id
)
```

- Si la relation n'existe pas → DELETE 0 rows → pas d'erreur
- Si `user_id` cible inexistant → DELETE 0 rows → COUNT = 0 → `{"is_following": false, "followers_count": 0}`

---

## Tableau comparatif follow vs unfollow

| Aspect | POST /follow | DELETE /follow |
|---|---|---|
| Auth | OUI | OUI |
| Self-check (400) | **OUI** | **NON** |
| Existence cible (404) | **OUI** | **NON** |
| Idempotent | OUI (ON CONFLICT) | OUI (DELETE 0 rows) |
| `is_following` retourné | `true` | `false` |
| `followers_count` recalculé | OUI (SELECT après) | OUI (SELECT après) |
| Erreurs possibles | 400, 401, 404 | 401 uniquement |
