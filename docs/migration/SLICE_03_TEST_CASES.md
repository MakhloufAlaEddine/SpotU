# SLICE_03_TEST_CASES.md — Cas de test
> Basé sur `user_routes.py:11–30`, `auth_utils.py`, `database.py`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## Objectif

Valider que l'implémentation Java de `GET /api/users/me` (Python : `GET /api/users/profile`)
produit des réponses **bit-à-bit compatibles** avec le backend Python pour les mêmes tokens JWT.

---

## TC-01 — Cas nominal : utilisateur avec des reviews

**Précondition :**
- Token JWT valide émis par Python (ou Java si Slice 02 migrée)
- `user_id` existe en DB
- L'utilisateur a **N ≥ 1 reviews** dans la table `reviews`
- `iban`, `bic`, `iban_name` renseignés

**Requête :**
```http
GET /api/users/me
Authorization: Bearer <valid_jwt_token>
```

**Réponse attendue : HTTP 200**
```json
{
  "user_id": "<user_id>",
  "email": "<email>",
  "name": "<name>",
  "role": "coach",
  "language": "fr",
  "picture": "<url_ou_null>",
  "bio": "<bio_ou_null>",
  "phone": "<phone_ou_null>",
  "is_coach_verified": true,
  "coach_tags": ["<tag_id_1>", ...],
  "show_phone": true,
  "show_reviews": true,
  "created_at": "<iso8601_avec_tz>",
  "updated_at": "<iso8601_avec_tz>",
  "sports_level": null,
  "goals": [],
  "user_roles": [],
  "onboarding_done": false,
  "avg_rating": 4.3,
  "review_count": 7,
  "iban": "FR76...",
  "bic": "BNPAFRPPXXX",
  "iban_name": "Thomas Dupont"
}
```

**Vérifications :**
- [ ] `avg_rating` = float, 1 décimale, non null
- [ ] `review_count` = entier > 0
- [ ] `iban`, `bic`, `iban_name` présents et non null
- [ ] `created_at` / `updated_at` au format ISO 8601 avec timezone (`+00:00`)
- [ ] `coach_tags` est un tableau de strings (pas un objet JSON)
- [ ] `goals` et `user_roles` sont des tableaux (pas null)
- [ ] Total : 23 champs dans la réponse

---

## TC-02 — Cas nominal : utilisateur sans review

**Précondition :**
- Token valide
- `user_id` existe en DB
- Aucune ligne dans `reviews` avec `reviewee_id = user_id`

**Réponse attendue : HTTP 200**

Champs spécifiques :
```json
{
  "avg_rating": null,
  "review_count": 0
}
```

**Vérifications :**
- [ ] `avg_rating` est strictement `null` (pas `0`, pas `0.0`)
- [ ] `review_count` est `0` (int, pas null)

---

## TC-03 — Cas nominal : utilisateur sans IBAN

**Précondition :**
- Token valide
- `iban`, `bic`, `iban_name` = NULL en DB

**Réponse attendue : HTTP 200**

Champs spécifiques :
```json
{
  "iban": null,
  "bic": null,
  "iban_name": null
}
```

**Vérifications :**
- [ ] Les 3 champs sont présents dans la réponse (même si null)
- [ ] Aucun champ n'est absent (clé manquante = erreur côté frontend)

---

## TC-04 — Token absent (ni header ni cookie)

**Requête :**
```http
GET /api/users/me
```
(Aucun header Authorization, aucun cookie winek_token)

**Réponse attendue : HTTP 401**
```json
{"detail": "Not authenticated"}
```

**Vérifications :**
- [ ] Status code = 401
- [ ] Corps = `{"detail": "Not authenticated"}`

---

## TC-05 — Token invalide (signature incorrecte)

**Requête :**
```http
GET /api/users/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature
```

**Réponse attendue : HTTP 401**
```json
{"detail": "Invalid token"}
```

**Vérifications :**
- [ ] Status code = 401
- [ ] Corps = `{"detail": "Invalid token"}`

---

## TC-06 — Token expiré

**Précondition :**
- Token valide mais dont le claim `exp` est dans le passé

**Requête :**
```http
GET /api/users/me
Authorization: Bearer <expired_jwt>
```

**Réponse attendue : HTTP 401**
```json
{"detail": "Token expired"}
```

**Vérifications :**
- [ ] Status code = 401
- [ ] Corps = `{"detail": "Token expired"}`

---

## TC-07 — Token valide mais user_id supprimé de la DB

**Précondition :**
- Token JWT valide (signature OK, non expiré)
- Mais le `user_id` encodé dans le payload n'existe plus en DB (suppression ou ID falsifié)

**Réponse attendue : HTTP 401**
```json
{"detail": "User not found"}
```

**Vérifications :**
- [ ] Status code = 401
- [ ] Corps = `{"detail": "User not found"}`

---

## TC-08 — Token via cookie (fallback)

**Précondition :**
- Token valide dans le cookie `winek_token`
- Pas d'header `Authorization`

**Requête :**
```http
GET /api/users/me
Cookie: winek_token=<valid_jwt>
```

**Réponse attendue : HTTP 200** (identique à TC-01)

**Vérifications :**
- [ ] Le cookie est lu en fallback
- [ ] La réponse est identique à celle avec header Authorization

---

## TC-09 — Token valide, avg_rating avec arrondi

**Précondition :**
- Reviews avec ratings : [5, 4, 4, 4, 3] → moyenne = 4.0
- Reviews avec ratings : [5, 5, 4, 3] → moyenne = 4.25 → arrondi = **4.3** (Python `round(4.25, 1)`)
- Reviews avec ratings : [3, 2] → moyenne = 2.5 → arrondi = **2.5**

**Vérifications :**
- [ ] `avg_rating = 4.0` pour [5, 4, 4, 4, 3]
- [ ] `avg_rating = 4.2` pour [5, 5, 4, 3] (Python `round(4.25, 1) = 4.2` — arrondi bancaire)
- [ ] `avg_rating = 2.5` pour [3, 2]

**ATTENTION :** Python `round(4.25, 1)` = `4.2` (arrondi vers le pair, pas vers le haut classique).
Comportement Python à reproduire exactement. Tester ce cas limite avec les ratings qui donnent
une valeur se terminant par .5 au niveau des dixièmes.

---

## TC-10 — Utilisateur de rôle "user" (pas coach)

**Précondition :**
- Token valide pour un user avec `role = "user"`
- Pas de reviews, pas d'IBAN

**Réponse attendue : HTTP 200**

**Vérifications :**
- [ ] `role` = `"user"` (pas `"coach"`)
- [ ] `is_coach_verified` = `false` ou `null`
- [ ] `coach_tags` = `[]`
- [ ] `avg_rating` = `null`
- [ ] `review_count` = `0`
- [ ] Aucune erreur 403 (l'endpoint est accessible quel que soit le rôle)

---

## TC-11 — Compatibilité croisée Python → Java

**Objectif :** Valider que les tokens JWT émis par Python sont acceptés par Java.

**Procédure :**
1. Login via `POST /api/auth/login` (Python, non migré)
2. Utiliser le token retourné pour appeler `GET /api/users/me` (Java)
3. Comparer la réponse Java avec la réponse Python pour le même token

**Vérifications :**
- [ ] Java accepte les tokens émis par Python (même `JWT_SECRET`)
- [ ] Les 23 champs sont identiques (valeurs + types)
- [ ] Les formats de datetime sont identiques (`+00:00` vs `Z` — à valider)

**Note critique :** Si Python retourne `"2026-04-01T12:51:14.682000+00:00"` et Java retourne
`"2026-04-01T12:51:14.682+00:00"` (différence de précision microseconde), c'est acceptable
côté frontend (les deux sont ISO 8601 valides). Documenter l'écart si présent.

---

## Résumé des cas

| # | Scénario | Résultat attendu |
|---|---|---|
| TC-01 | Nominal avec reviews et IBAN | 200 — 23 champs |
| TC-02 | Sans reviews | 200 — avg_rating=null, count=0 |
| TC-03 | Sans IBAN | 200 — iban/bic/iban_name=null |
| TC-04 | Token absent | 401 Not authenticated |
| TC-05 | Token invalide | 401 Invalid token |
| TC-06 | Token expiré | 401 Token expired |
| TC-07 | user_id absent DB | 401 User not found |
| TC-08 | Token via cookie | 200 — identique TC-01 |
| TC-09 | Arrondi avg_rating | 200 — vérif précision Python |
| TC-10 | Rôle "user" | 200 — accessible sans restriction |
| TC-11 | Compat Python→Java | 200 — tokens croisés valides |
