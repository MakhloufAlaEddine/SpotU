# SLICE_07_TEST_CASES.md — Cas de test
> Basé sur `user_routes.py:632–664`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## POST /block

### TC-01 — Block nominal (nouvelle relation)

**Précondition :**
- Token valide pour `user_a`
- `user_b` existe en DB
- `user_a` suit `user_b` ET `user_b` suit `user_a` (relation mutuelle)
- Aucun blocage existant

**Requête :**
```http
POST /api/users/user_b/block
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200**
```json
{"blocked": true}
```

**Vérifications :**
- [ ] Status = 200
- [ ] `blocked = true`
- [ ] Ligne `(user_a, user_b)` insérée dans `user_blocks`
- [ ] Ligne `(user_a → user_b)` supprimée de `user_follows`
- [ ] Ligne `(user_b → user_a)` supprimée de `user_follows`
- [ ] `GET /api/users/user_b/followers` ne contient plus `user_a`
- [ ] `GET /api/users/user_a/followers` ne contient plus `user_b`

---

### TC-02 — Block quand aucun follow existant

**Précondition :**
- `user_a` et `user_b` ne se suivent pas

**Réponse attendue : HTTP 200**
```json
{"blocked": true}
```

**Vérifications :**
- [ ] Bloc inséré normalement
- [ ] DELETE `user_follows` exécuté mais 0 rows supprimées — pas d'erreur

---

### TC-03 — Double block (idempotent)

**Précondition :**
- `user_a` a déjà bloqué `user_b`

**Requête :**
```http
POST /api/users/user_b/block
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200** (pas 409)
```json
{"blocked": true}
```

**Vérifications :**
- [ ] Status = 200
- [ ] Toujours 1 seule ligne dans `user_blocks` pour cette paire
- [ ] Pas d'erreur DB

---

### TC-04 — Self-block interdit

**Requête :**
```http
POST /api/users/user_a/block
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 400**
```json
{"detail": "Vous ne pouvez pas vous bloquer vous-même."}
```

**Vérifications :**
- [ ] Status = 400
- [ ] Message exact (en français)
- [ ] Aucune modification en DB

---

### TC-05 — Sans token

**Requête :**
```http
POST /api/users/user_b/block
```

**Réponse attendue : HTTP 401**
```json
{"detail": "Not authenticated"}
```

---

### TC-06 — Token invalide

**Réponse attendue : HTTP 401** (pas 200 comme Slice 04/06)

---

## DELETE /block

### TC-07 — Unblock nominal

**Précondition :**
- `user_a` a bloqué `user_b` (ligne dans `user_blocks`)

**Requête :**
```http
DELETE /api/users/user_b/block
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200**
```json
{"blocked": false}
```

**Vérifications :**
- [ ] Status = 200
- [ ] `blocked = false`
- [ ] Ligne supprimée de `user_blocks`
- [ ] `user_follows` non modifiée (les follows ne sont pas restaurés)

---

### TC-08 — Unblock silencieux (blocage inexistant)

**Précondition :**
- Aucun blocage `(user_a, user_b)` en DB

**Réponse attendue : HTTP 200** (pas de 404)
```json
{"blocked": false}
```

**Vérifications :**
- [ ] Status = 200
- [ ] `blocked = false`

---

### TC-09 — Unblock : follows non restaurés

**Procédure :**
1. `user_a` suit `user_b` et vice-versa
2. `POST /api/users/user_b/block` → suit supprimés
3. `DELETE /api/users/user_b/block` → unblock
4. `GET /api/users/user_b/followers` → `user_a` absent
5. `GET /api/users/user_a/followers` → `user_b` absent

**Vérifications :**
- [ ] Après unblock, les follows ne sont pas restaurés
- [ ] `is_following = false` dans le profil de `user_b` pour `user_a`

---

### TC-10 — Self-unblock (comportement silencieux)

**Précondition :** `user_id` dans l'URL = caller

**Requête :**
```http
DELETE /api/users/user_a/block
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200** (pas de 400 — unblock ne vérifie pas self)
```json
{"blocked": false}
```

---

### TC-11 — Sans token (unblock)

**Réponse attendue : HTTP 401**

---

## Tests de cohérence cross-slices

### TC-12 — Cohérence Slice 04 après block

**Procédure :**
1. `GET /api/users/user_b/public` avec token `user_a` → noter `followers_count`
2. `POST /api/users/user_b/block` (user_a bloque user_b, les deux se suivaient)
3. `GET /api/users/user_b/public` avec token `user_a` → vérifier counts et `is_following`

**Vérifications :**
- [ ] `is_following = false` après le block
- [ ] `followers_count` diminué si `user_a` était dans les followers de `user_b`

---

### TC-13 — Séquence block → unblock → follow

**Procédure :**
1. `POST /api/users/user_b/block`
2. `DELETE /api/users/user_b/block`
3. `POST /api/users/user_b/follow` — doit fonctionner (plus de blocage)

**Vérifications :**
- [ ] Follow possible après unblock
- [ ] `is_following = true` dans Slice 04

---

## Résumé des cas

| # | Endpoint | Scénario | Résultat attendu |
|---|---|---|---|
| TC-01 | POST /block | Nominal, suivi mutuel | 200 — bloc + 2 follows supprimés |
| TC-02 | POST /block | Aucun follow | 200 — bloc inséré, 0 follows supprimés |
| TC-03 | POST /block | Double block | 200 — idempotent |
| TC-04 | POST /block | Self-block | 400 message FR exact |
| TC-05 | POST /block | Sans token | 401 |
| TC-06 | POST /block | Token invalide | 401 |
| TC-07 | DELETE /block | Nominal | 200 — bloc supprimé, follows non restaurés |
| TC-08 | DELETE /block | Blocage inexistant | 200 silencieux |
| TC-09 | DELETE /block | Follows non restaurés | 200 — user_follows inchangé |
| TC-10 | DELETE /block | Self-unblock | 200 silencieux (pas 400) |
| TC-11 | DELETE /block | Sans token | 401 |
| TC-12 | Cross | Cohérence Slice 04 | is_following=false, counts ajustés |
| TC-13 | Cross | block → unblock → follow | Follow possible après unblock |
