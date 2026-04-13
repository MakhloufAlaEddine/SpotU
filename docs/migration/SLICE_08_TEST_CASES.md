# SLICE_08_TEST_CASES.md — Cas de test
> Basé sur `user_routes.py:238–259`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## TC-01 — Nominal : user avec reviews publiques

**Précondition :**
- `user_b` existe, `show_reviews=true`
- 3 reviews dans `reviews` avec `reviewee_id=user_b`
- Chaque reviewer existe dans `users`

**Requête :**
```http
GET /api/users/user_b/reviews
```
(Sans aucun header ni token)

**Réponse attendue : HTTP 200**
```json
[
  {
    "review_id": "rev_abc123",
    "rating": 5,
    "comment": "Excellent !",
    "created_at": "2026-04-10T14:30:00.000000+00:00",
    "reviewer_id": "user_xyz789",
    "reviewer_name": "Alice Martin",
    "reviewer_picture": "https://example.com/alice.jpg"
  },
  {
    "review_id": "rev_def456",
    "rating": 4,
    "comment": null,
    "created_at": "2026-03-20T09:15:00.000000+00:00",
    "reviewer_id": "user_ghi012",
    "reviewer_name": "Bob Dupont",
    "reviewer_picture": null
  }
]
```

**Vérifications :**
- [ ] HTTP 200
- [ ] 3 objets dans le tableau
- [ ] Triés par `created_at DESC` (plus récent en premier)
- [ ] `review_id` présent et non null
- [ ] `rating` entre 1 et 5 (int, pas string)
- [ ] `comment` null si non renseigné (pas `""`)
- [ ] `created_at` au format ISO 8601 avec timezone (`+00:00`)
- [ ] `reviewer_picture` null si non renseigné
- [ ] 7 champs exactement par objet (pas de `booking_id` ni `reviewee_id`)

---

## TC-02 — show_reviews=false : liste vide (pas 403)

**Précondition :**
- `user_b` existe, `show_reviews=false`
- Plusieurs reviews en DB avec `reviewee_id=user_b`

**Réponse attendue : HTTP 200**
```json
[]
```

**Vérifications :**
- [ ] HTTP 200 (pas 403)
- [ ] Tableau vide `[]`
- [ ] Pas de champ `detail` dans la réponse

---

## TC-03 — User avec 0 reviews (show_reviews=true)

**Précondition :**
- `user_b` existe, `show_reviews=true`
- Aucune review dans `reviews` pour ce user

**Réponse attendue : HTTP 200**
```json
[]
```

**Vérifications :**
- [ ] HTTP 200
- [ ] `[]` (pas null, pas omis)

---

## TC-04 — user_id inexistant

**Requête :**
```http
GET /api/users/user_inexistant_xxxx/reviews
```

**Réponse attendue : HTTP 404**
```json
{"detail": "User not found"}
```

**Vérifications :**
- [ ] HTTP 404
- [ ] Corps = `{"detail": "User not found"}`

---

## TC-05 — Avec token (ignoré)

**Requête :**
```http
GET /api/users/user_b/reviews
Authorization: Bearer <valid_jwt>
```

**Réponse attendue : HTTP 200** (identique à TC-01 — token ignoré)

**Vérifications :**
- [ ] Le token n'influence pas la réponse
- [ ] Même liste qu'en TC-01

---

## TC-06 — Token invalide (ignoré)

**Requête :**
```http
GET /api/users/user_b/reviews
Authorization: Bearer invalid.token.here
```

**Réponse attendue : HTTP 200** (pas 401 — token non lu)

---

## TC-07 — Tri par date décroissante

**Précondition :**
- 3 reviews avec `created_at` différents : 2026-01-01, 2026-03-01, 2026-04-10

**Vérifications :**
- [ ] Review du 2026-04-10 en premier
- [ ] Review du 2026-01-01 en dernier

---

## TC-08 — Champs exacts par review (pas de champs supplémentaires)

**Vérifications pour chaque objet de la liste :**
- [ ] `review_id` présent
- [ ] `rating` présent (int)
- [ ] `comment` présent (string ou null)
- [ ] `created_at` présent (string ISO 8601 tz)
- [ ] `reviewer_id` présent (string)
- [ ] `reviewer_name` présent (string)
- [ ] `reviewer_picture` présent (string ou null)
- [ ] `booking_id` **absent** de la réponse
- [ ] `reviewee_id` **absent** de la réponse
- [ ] Total : 7 champs exactement

---

## TC-09 — Cohérence Slice 04 (avg_rating / review_count)

**Procédure :**
1. `GET /api/users/user_b/public` → noter `avg_rating` et `review_count`
2. `GET /api/users/user_b/reviews` → compter les objets

**Vérifications :**
- [ ] Si Slice 04 `show_reviews=true` : `review_count` == len(reviews de Slice 08)
- [ ] Si Slice 04 `show_reviews=false` : Slice 08 retourne `[]` (review_count=0 des deux côtés)
- [ ] `avg_rating` calculé sur Slice 08 = `round(sum(ratings)/len, 1)` = valeur Slice 04

---

## TC-10 — Cohérence Slice 03 (avg_rating dans /api/users/me)

**Précondition :** Même `user_id` authentifié

**Procédure :**
1. `GET /api/users/me` → noter `avg_rating` et `review_count` (toujours calculés, non conditionnels)
2. `GET /api/users/{user_id}/reviews` → compter et calculer avg

**Vérifications :**
- [ ] `avg_rating` de Slice 03 correspond au calcul sur les reviews de Slice 08 (même si show_reviews=false)
- [ ] Note : Slice 03 ignore `show_reviews` — Slice 08 l'applique. La divergence est intentionnelle.

---

## Résumé des cas

| # | Scénario | Résultat attendu |
|---|---|---|
| TC-01 | Nominal, reviews publiques | 200 — liste triée, 7 champs |
| TC-02 | show_reviews=false | 200 — `[]` (pas 403) |
| TC-03 | show_reviews=true, 0 reviews | 200 — `[]` |
| TC-04 | user inexistant | 404 "User not found" |
| TC-05 | Avec token valide | 200 — token ignoré |
| TC-06 | Avec token invalide | 200 — pas 401 |
| TC-07 | Tri DESC | Plus récent en premier |
| TC-08 | Champs exacts | 7 champs, booking_id absent |
| TC-09 | Cohérence Slice 04 | review_count == len(reviews) |
| TC-10 | Cohérence Slice 03 | avg_rating cohérent |
