# SLICE_06_TEST_CASES.md — Cas de test
> Basé sur `user_routes.py:568–613`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## GET /followers

### TC-01 — Nominal : liste de followers, appelant authentifié

**Précondition :**
- `user_b` a 3 followers : `user_a`, `user_c`, `user_d`
- L'appelant (`user_x`) est authentifié
- `user_x` suit `user_a` (→ `is_following_back = true`)
- `user_x` a bloqué `user_c` (→ `is_blocked = true`)

**Requête :**
```http
GET /api/users/user_b/followers
Authorization: Bearer <valid_jwt_x>
```

**Réponse attendue : HTTP 200**
```json
[
  { "user_id": "user_a", "name": "Alice", "picture": null, "role": "user",
    "is_following_back": true,  "is_blocked": false },
  { "user_id": "user_c", "name": "Camille", "picture": null, "role": "user",
    "is_following_back": false, "is_blocked": true },
  { "user_id": "user_d", "name": "David", "picture": null, "role": "coach",
    "is_following_back": false, "is_blocked": false }
]
```

**Vérifications :**
- [ ] HTTP 200
- [ ] 3 objets dans le tableau
- [ ] Triés alphabétiquement par `name` (Alice, Camille, David)
- [ ] `is_following_back = true` pour user_a uniquement
- [ ] `is_blocked = true` pour user_c uniquement
- [ ] user_c apparaît bien (pas filtré malgré le blocage)

---

### TC-02 — Nominal : sans token

**Requête :**
```http
GET /api/users/user_b/followers
```
(Aucun header, aucun cookie)

**Réponse attendue : HTTP 200** (pas de 401)
```json
[
  { "user_id": "user_a", "name": "Alice", "picture": null, "role": "user",
    "is_following_back": false, "is_blocked": false },
  ...
]
```

**Vérifications :**
- [ ] HTTP 200
- [ ] `is_following_back = false` pour tous
- [ ] `is_blocked = false` pour tous

---

### TC-03 — Token invalide (comportement auth optionnelle)

**Requête :**
```http
GET /api/users/user_b/followers
Authorization: Bearer invalid.token.here
```

**Réponse attendue : HTTP 200** (token invalide → me_id = null, pas de 401)

**Vérifications :**
- [ ] HTTP 200 (pas 401)
- [ ] `is_following_back = false`, `is_blocked = false` pour tous

---

### TC-04 — user_id inexistant

**Requête :**
```http
GET /api/users/user_inexistant_xxxx/followers
```

**Réponse attendue : HTTP 200**
```json
[]
```

**Vérifications :**
- [ ] HTTP 200 (pas 404)
- [ ] Tableau vide

---

### TC-05 — user_id sans aucun follower

**Précondition :** `user_z` existe mais n'a aucun follower

**Réponse attendue : HTTP 200**
```json
[]
```

---

## GET /following

### TC-06 — Nominal : liste de following, appelant authentifié

**Précondition :**
- `user_b` suit `user_e` et `user_f`
- L'appelant (`user_x`) est authentifié
- `user_e` suit `user_x` (→ `follows_back = true`)

**Requête :**
```http
GET /api/users/user_b/following
Authorization: Bearer <valid_jwt_x>
```

**Réponse attendue : HTTP 200**
```json
[
  { "user_id": "user_e", "name": "Emma", "picture": null, "role": "coach",
    "follows_back": true,  "is_blocked": false },
  { "user_id": "user_f", "name": "François", "picture": null, "role": "user",
    "follows_back": false, "is_blocked": false }
]
```

**Vérifications :**
- [ ] HTTP 200
- [ ] Champ `follows_back` (pas `is_following_back`)
- [ ] Triés alphabétiquement (Emma avant François)
- [ ] `follows_back = true` pour user_e uniquement

---

### TC-07 — Nominal : sans token

**Requête :**
```http
GET /api/users/user_b/following
```

**Réponse attendue : HTTP 200**
```json
[
  { "user_id": "user_e", "name": "Emma", "picture": null, "role": "coach",
    "follows_back": false, "is_blocked": false }
]
```

**Vérifications :**
- [ ] HTTP 200
- [ ] `follows_back = false` pour tous
- [ ] `is_blocked = false` pour tous

---

### TC-08 — user_id inexistant (/following)

**Réponse attendue : HTTP 200, `[]`** (identique à TC-04)

---

### TC-09 — user_id sans aucun abonnement

**Réponse attendue : HTTP 200, `[]`**

---

## Tests croisés

### TC-10 — Vérification du tri alphabétique strict

**Précondition :** Followers avec noms : "Zoé", "André", "Marie", "Benoît"

**Vérifications :**
- [ ] Ordre retourné : André, Benoît, Marie, Zoé (ordre ASCII/collation DB)
- [ ] Attention : la collation PostgreSQL peut différer de Java String.compareTo()
- [ ] Utiliser la requête SQL `ORDER BY u.name ASC` — ne pas trier applicativement

---

### TC-11 — Différence structurelle followers vs following

**Précondition :** Même user_id pour les deux appels

**Requêtes :**
```http
GET /api/users/user_b/followers
GET /api/users/user_b/following
```

**Vérifications :**
- [ ] `/followers` contient le champ `is_following_back` (pas `follows_back`)
- [ ] `/following` contient le champ `follows_back` (pas `is_following_back`)
- [ ] Les deux tableaux peuvent contenir des user_id différents
- [ ] Si user_a est follower ET following : apparaît dans les deux listes

---

### TC-12 — Cohérence après Slice 05 (follow/unfollow)

**Procédure :**
1. `GET /api/users/user_b/followers` → noter la liste (N items)
2. `POST /api/users/user_b/follow` (user_x suit user_b)
3. `GET /api/users/user_b/followers` → doit contenir user_x maintenant (N+1 items)
4. `DELETE /api/users/user_b/follow`
5. `GET /api/users/user_b/followers` → user_x disparu (N items)

**Vérifications :**
- [ ] Les listes de Slice 06 reflètent les mutations de Slice 05

---

## Résumé des cas

| # | Endpoint | Scénario | Résultat attendu |
|---|---|---|---|
| TC-01 | /followers | Nominal, auth | 200 — tri, is_following_back, is_blocked corrects |
| TC-02 | /followers | Sans token | 200 — champs contextuels = false |
| TC-03 | /followers | Token invalide | 200 (pas 401) |
| TC-04 | /followers | user inexistant | 200 — [] |
| TC-05 | /followers | Aucun follower | 200 — [] |
| TC-06 | /following | Nominal, auth | 200 — follows_back correct |
| TC-07 | /following | Sans token | 200 — follows_back = false |
| TC-08 | /following | user inexistant | 200 — [] |
| TC-09 | /following | Aucun following | 200 — [] |
| TC-10 | Les deux | Tri alphabétique | ORDER BY u.name ASC strict |
| TC-11 | Les deux | Noms de champs | is_following_back ≠ follows_back |
| TC-12 | /followers | Cohérence Slice 05 | Liste mise à jour après follow/unfollow |
