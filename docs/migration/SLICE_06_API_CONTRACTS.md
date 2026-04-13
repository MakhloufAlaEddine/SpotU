# SLICE_06_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `user_routes.py:568–613`.
> Généré le 2026-02-XX.

---

## ENDPOINT 1 — GET /api/users/{user_id}/followers

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/users/{user_id}/followers` |
| Chemin Java cible | `/api/users/{userId}/followers` |
| Auth | **OPTIONNELLE** (`get_optional_auth`) |
| Pagination | **NON** — toute la liste retournée |
| Tri | `ORDER BY u.name ASC` (alphabétique) |
| Handler | `list_followers()` — `user_routes.py:568–589` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | Le profil dont on veut les followers |

### Query Params / Body

**Aucun.**

### Réponse — HTTP 200 avec token valide (me_id connu)

```json
[
  {
    "user_id": "user_abc123",
    "name": "Alice Martin",
    "picture": "https://example.com/alice.jpg",
    "role": "user",
    "is_following_back": true,
    "is_blocked": false
  },
  {
    "user_id": "user_def456",
    "name": "Bob Dupont",
    "picture": null,
    "role": "coach",
    "is_following_back": false,
    "is_blocked": false
  }
]
```

### Réponse — HTTP 200 sans token (me_id = null)

```json
[
  {
    "user_id": "user_abc123",
    "name": "Alice Martin",
    "picture": "https://example.com/alice.jpg",
    "role": "user",
    "is_following_back": false,
    "is_blocked": false
  }
]
```
*(Les champs contextuels sont `false` quand non authentifié)*

### Réponse — HTTP 200 si user_id inexistant ou sans followers

```json
[]
```

### Schéma d'un objet `FollowerDto`

| Champ | Type JSON | Type Java | Nullable | Source | Note |
|---|---|---|---|---|---|
| `user_id` | `string` | `String` | NON | `users.user_id` | |
| `name` | `string` | `String` | NON | `users.name` | |
| `picture` | `string\|null` | `String` | OUI | `users.picture` | URL ou null |
| `role` | `string` | `String` | OUI | `users.role` | `"user"`, `"coach"`, `"admin"` |
| `is_following_back` | `boolean` | `boolean` | NON | EXISTS(`user_follows`) | `false` si non auth |
| `is_blocked` | `boolean` | `boolean` | NON | EXISTS(`user_blocks`) | `false` si non auth |

### Sémantique de `is_following_back`

> "Est-ce que MOI (l'appelant) je suis CE follower ?"

```sql
EXISTS(SELECT 1 FROM user_follows WHERE follower_id=$1 AND following_id=u.user_id)
-- $1 = me_id, u.user_id = le follower listé
```

---

## ENDPOINT 2 — GET /api/users/{user_id}/following

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `GET` |
| Chemin Python | `/api/users/{user_id}/following` |
| Chemin Java cible | `/api/users/{userId}/following` |
| Auth | **OPTIONNELLE** (`get_optional_auth`) |
| Pagination | **NON** — toute la liste retournée |
| Tri | `ORDER BY u.name ASC` (alphabétique) |
| Handler | `list_following()` — `user_routes.py:592–613` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | Le profil dont on veut la liste des abonnements |

### Query Params / Body

**Aucun.**

### Réponse — HTTP 200 avec token valide

```json
[
  {
    "user_id": "user_xyz789",
    "name": "Claire Durand",
    "picture": "https://example.com/claire.jpg",
    "role": "coach",
    "follows_back": true,
    "is_blocked": false
  }
]
```

### Schéma d'un objet `FollowingDto`

| Champ | Type JSON | Type Java | Nullable | Source | Note |
|---|---|---|---|---|---|
| `user_id` | `string` | `String` | NON | `users.user_id` | |
| `name` | `string` | `String` | NON | `users.name` | |
| `picture` | `string\|null` | `String` | OUI | `users.picture` | |
| `role` | `string` | `String` | OUI | `users.role` | |
| `follows_back` | `boolean` | `boolean` | NON | EXISTS(`user_follows`) | `false` si non auth |
| `is_blocked` | `boolean` | `boolean` | NON | EXISTS(`user_blocks`) | `false` si non auth |

### Sémantique de `follows_back`

> "Est-ce que CET abonnement me suit MOI (l'appelant) en retour ?"

```sql
EXISTS(SELECT 1 FROM user_follows WHERE follower_id=u.user_id AND following_id=$1)
-- u.user_id = le following listé, $1 = me_id
```

---

## Tableau comparatif followers vs following

| Aspect | GET /followers | GET /following |
|---|---|---|
| Source JOIN `user_follows` | `uf.follower_id` (ceux qui suivent `user_id`) | `uf.following_id` (ceux que `user_id` suit) |
| JOIN `users` sur | `u.user_id = uf.follower_id` | `u.user_id = uf.following_id` |
| WHERE | `uf.following_id = $2` | `uf.follower_id = $2` |
| Champ mutual | `is_following_back` | `follows_back` |
| Sens mutual check | caller → follower listé | following listé → caller |
| Auth | OPTIONNELLE | OPTIONNELLE |
| Pagination | NON | NON |
| Tri | `u.name ASC` | `u.name ASC` |
| Champs retournés | 6 (same) | 6 (same, noms différents) |
| 404 si user_id absent | **NON** — `[]` | **NON** — `[]` |

---

## Codes d'erreur

| Code | Condition | Source |
|---|---|---|
| **Aucune erreur HTTP possible** sauf 500 | `user_id` inexistant → `[]` | Comportement JOIN vide |
| `500` | DB inaccessible | Non géré explicitement |

**Note :** Il n'y a pas de 401, pas de 404. La seule réponse applicative est HTTP 200.
