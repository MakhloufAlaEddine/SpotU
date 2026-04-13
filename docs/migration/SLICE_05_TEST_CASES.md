# SLICE_05_TEST_CASES.md — Cas de test
> Basé sur `user_routes.py:494–522`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## TC-01 — Follow nominal (nouvelle relation)

**Précondition :**
- Token valide pour `user_a`
- `user_b` existe en DB
- Aucune relation `user_a → user_b` dans `user_follows`
- `user_b` a actuellement `N` followers

**Requête :**
```http
POST /api/users/user_b/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200**
```json
{
  "is_following": true,
  "followers_count": N+1
}
```

**Vérifications :**
- [ ] Status = 200
- [ ] `is_following = true`
- [ ] `followers_count = N + 1`
- [ ] Ligne `(user_a, user_b)` insérée dans `user_follows`

---

## TC-02 — Follow idempotent (double follow)

**Précondition :**
- Relation `user_a → user_b` **déjà existante** dans `user_follows`

**Requête :**
```http
POST /api/users/user_b/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200** (pas d'erreur, pas de doublon)
```json
{
  "is_following": true,
  "followers_count": N
}
```

**Vérifications :**
- [ ] Status = 200 (pas 409)
- [ ] `is_following = true`
- [ ] `followers_count` = même valeur qu'avant (pas de doublon)
- [ ] Table `user_follows` : toujours 1 seule ligne pour cette paire

---

## TC-03 — Unfollow nominal (relation existante)

**Précondition :**
- Token valide pour `user_a`
- Relation `user_a → user_b` existe
- `user_b` a actuellement `N` followers

**Requête :**
```http
DELETE /api/users/user_b/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200**
```json
{
  "is_following": false,
  "followers_count": N-1
}
```

**Vérifications :**
- [ ] Status = 200
- [ ] `is_following = false`
- [ ] `followers_count = N - 1`
- [ ] Ligne supprimée de `user_follows`

---

## TC-04 — Unfollow idempotent (relation inexistante)

**Précondition :**
- Token valide pour `user_a`
- Aucune relation `user_a → user_b` dans `user_follows`
- `user_b` a actuellement 0 followers

**Requête :**
```http
DELETE /api/users/user_b/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200** (pas de 404)
```json
{
  "is_following": false,
  "followers_count": 0
}
```

**Vérifications :**
- [ ] Status = 200 (pas 404)
- [ ] `is_following = false`
- [ ] `followers_count = 0`

---

## TC-05 — Self-follow interdit

**Précondition :**
- Token valide pour `user_a`
- `user_id` dans l'URL = `user_a` (même utilisateur)

**Requête :**
```http
POST /api/users/user_a/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 400**
```json
{"detail": "Vous ne pouvez pas vous suivre vous-même."}
```

**Vérifications :**
- [ ] Status = 400
- [ ] Corps = `{"detail": "Vous ne pouvez pas vous suivre vous-même."}`
- [ ] Aucune ligne insérée dans `user_follows`

---

## TC-06 — Self-unfollow (comportement silencieux attendu)

**Précondition :**
- Token valide pour `user_a`
- `user_id` dans l'URL = `user_a`
- Aucune ligne `(user_a, user_a)` en DB (impossible normalement)

**Requête :**
```http
DELETE /api/users/user_a/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200** (pas de 400 — unfollow ne vérifie pas self)
```json
{
  "is_following": false,
  "followers_count": N
}
```

**Vérifications :**
- [ ] Status = 200 (pas 400)
- [ ] `is_following = false`

---

## TC-07 — Follow : user cible introuvable

**Précondition :**
- `user_id` cible n'existe pas en DB

**Requête :**
```http
POST /api/users/user_inexistant_xxxx/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 404**
```json
{"detail": "Utilisateur introuvable."}
```

**Vérifications :**
- [ ] Status = 404
- [ ] Corps = `{"detail": "Utilisateur introuvable."}`

---

## TC-08 — Unfollow : user cible inexistant (silencieux)

**Précondition :**
- `user_id` cible n'existe pas en DB

**Requête :**
```http
DELETE /api/users/user_inexistant_xxxx/follow
Authorization: Bearer <valid_jwt_a>
```

**Réponse attendue : HTTP 200** (pas de 404)
```json
{
  "is_following": false,
  "followers_count": 0
}
```

**Vérifications :**
- [ ] Status = 200 (pas 404)
- [ ] `is_following = false`
- [ ] `followers_count = 0`

---

## TC-09 — Token absent (les deux endpoints)

**Requêtes :**
```http
POST /api/users/user_b/follow
DELETE /api/users/user_b/follow
```
(sans Authorization ni cookie)

**Réponse attendue : HTTP 401**
```json
{"detail": "Not authenticated"}
```

**Vérifications :**
- [ ] Status = 401 (les deux endpoints)
- [ ] Aucune modification en DB

---

## TC-10 — Token invalide (les deux endpoints)

**Requêtes :**
```http
POST /api/users/user_b/follow
Authorization: Bearer invalid.token.here
```

**Réponse attendue : HTTP 401**
```json
{"detail": "Invalid token"}
```

**Vérifications :**
- [ ] Status = 401 (pas 200 comme Slice 04 — auth stricte ici)

---

## TC-11 — Séquence follow puis unfollow puis follow

**Procédure :**
1. `POST /follow` → is_following=true, count=N+1
2. `DELETE /follow` → is_following=false, count=N
3. `POST /follow` → is_following=true, count=N+1

**Vérifications :**
- [ ] Chaque opération retourne l'état correct
- [ ] `followers_count` cohérent à chaque étape
- [ ] Après l'étape 3, `GET /api/users/user_b/public` (Slice 04) retourne `is_following=true`

---

## TC-12 — Cohérence avec Slice 04 (GET /api/users/{id}/public)

**Procédure :**
1. `GET /api/users/user_b/public` (avec token user_a) → note `is_following` et `followers_count`
2. `POST /api/users/user_b/follow` (si `is_following=false`) ou `DELETE /follow` (si `true`)
3. `GET /api/users/user_b/public` → vérifier que `is_following` et `followers_count` ont changé

**Vérifications :**
- [ ] Les valeurs retournées par Slice 05 et Slice 04 sont cohérentes

---

## Résumé des cas

| # | Scénario | Résultat attendu |
|---|---|---|
| TC-01 | Follow nominal | 200 — is_following=true, count+1 |
| TC-02 | Double follow | 200 — idempotent, pas de doublon |
| TC-03 | Unfollow nominal | 200 — is_following=false, count-1 |
| TC-04 | Unfollow inexistant | 200 — silencieux, count=0 |
| TC-05 | Self-follow | 400 message FR exact |
| TC-06 | Self-unfollow | 200 — silencieux (pas 400) |
| TC-07 | Follow user inexistant | 404 message FR exact |
| TC-08 | Unfollow user inexistant | 200 — silencieux |
| TC-09 | Sans token | 401 |
| TC-10 | Token invalide | 401 (pas 200) |
| TC-11 | Séquence F→U→F | Cohérence des counts |
| TC-12 | Cohérence Slice 04 | is_following synchronisé |
