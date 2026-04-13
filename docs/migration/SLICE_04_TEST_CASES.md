# SLICE_04_TEST_CASES.md — Cas de test
> Basé sur `user_routes.py:99–235`, `spot_you_routes.py:27–109`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## TC-01 — Cas nominal : profil non-coach, sans reviews publiques

**Précondition :**
- `user_id` existe en DB
- `role = "user"` (pas coach)
- `show_reviews = false`
- `show_phone = false`
- Pas de tag_points actifs

**Requête (sans token) :**
```http
GET /api/users/user_abc123/public
```

**Réponse attendue : HTTP 200**
```json
{
  "user_id": "user_abc123",
  "name": "Marie Martin",
  "picture": null,
  "cover_picture": null,
  "cover_offset_y": null,
  "cover_scale": null,
  "role": "user",
  "bio": null,
  "is_coach_verified": false,
  "coach_tags": [],
  "show_phone": false,
  "show_reviews": false,
  "phone": null,
  "followers_count": 0,
  "following_count": 0,
  "is_following": false,
  "interests": [],
  "avg_rating": null,
  "review_count": 0,
  "tag_points": []
}
```

**Vérifications :**
- [ ] `phone = null` (masqué car show_phone=false)
- [ ] `avg_rating = null` (masqué car show_reviews=false)
- [ ] `review_count = 0`
- [ ] Pas de clé `services` dans la réponse
- [ ] `is_following = false` (non authentifié)
- [ ] `interests = []`

---

## TC-02 — Cas nominal : profil coach, reviews publiques, tag_points actifs, authentifié et suiveur

**Précondition :**
- `role = "coach"`, `is_coach_verified = true`
- `show_reviews = true`, 5 reviews avec notes [5, 5, 4, 4, 5]
- `show_phone = true`, phone renseigné
- `coach_tags = ["tag_hatha"]`
- 2 services actifs
- 1 tag_point actif avec `maximum_participants = 10`, `going_count = 10` (→ is_full=true)
- L'appelant suit le profil cible

**Requête (avec token valide) :**
```http
GET /api/users/user_demo001/public
Authorization: Bearer <valid_jwt>
```

**Vérifications :**
- [ ] `is_following = true`
- [ ] `avg_rating = 4.6` (`round(23/5, 1) = 4.6`)
- [ ] `review_count = 5`
- [ ] `phone` non null (show_phone=true)
- [ ] `interests` contient 1 objet avec `tag_id`, `label_fr`, `label_en`, `icon`
- [ ] `services` présent, contient 2 éléments
- [ ] `tag_points[0].is_full = true`
- [ ] `tag_points[0].participants_count = 10`, `going_count = 10`
- [ ] `services` contient `price` (number, pas string)

---

## TC-03 — user_id inexistant

**Requête :**
```http
GET /api/users/user_xxxxxxxxxxxxxxxx/public
```

**Réponse attendue : HTTP 404**
```json
{"detail": "User not found"}
```

**Vérifications :**
- [ ] Status = 404
- [ ] Corps = `{"detail": "User not found"}`
- [ ] Pas de 401 (le token n'est pas requis)

---

## TC-04 — Sans token (non authentifié)

**Précondition :** Profil coach avec reviews publiques et services actifs

**Requête (aucun header, aucun cookie) :**
```http
GET /api/users/user_demo001/public
```

**Réponse attendue : HTTP 200** (identique à TC-02 sauf `is_following`)

**Vérifications :**
- [ ] Réponse HTTP 200 (pas de 401)
- [ ] `is_following = false` (pas de me_id)
- [ ] Tous les autres champs inchangés

---

## TC-05 — Token invalide (signature incorrecte)

**Requête :**
```http
GET /api/users/user_demo001/public
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.sig
```

**Réponse attendue : HTTP 200** (token invalide → me_id=null → comportement identique à TC-04)

**Vérifications :**
- [ ] Réponse HTTP 200 (pas de 401)
- [ ] `is_following = false`
- [ ] Tous les autres champs identiques à sans token

---

## TC-06 — Token valide, consulte son propre profil

**Précondition :** Token valide pour `user_demo001`, consulte `GET /api/users/user_demo001/public`

**Vérifications :**
- [ ] HTTP 200
- [ ] `is_following = false` (on ne peut pas se suivre soi-même, `me_id == user_id` → false)

---

## TC-07 — show_phone = true, phone null en DB

**Précondition :** `show_phone = true` mais `phone IS NULL` en DB

**Vérifications :**
- [ ] `phone = null` dans la réponse (pas d'erreur)
- [ ] `show_phone = true` dans la réponse

---

## TC-08 — show_reviews = true, 0 reviews

**Précondition :** `show_reviews = true`, aucune ligne dans `reviews` pour ce user

**Vérifications :**
- [ ] `avg_rating = null` (pas 0.0)
- [ ] `review_count = 0`

---

## TC-09 — Tag_point avec maximum_participants = null (is_full doit être false)

**Précondition :** tag_point avec `maximum_participants = null`, `going_count = 100`

**Vérifications :**
- [ ] `is_full = false` (maximum_participants null → jamais full)
- [ ] `going_count = 100`

---

## TC-10 — Tag_point sans votes

**Précondition :** tag_point sans ligne dans `tag_point_votes`

**Vérifications :**
- [ ] `rating = 0` (pas null)
- [ ] `vote_count = 0` (pas null)

---

## TC-11 — Profil coach sans services actifs

**Précondition :** `role = "coach"`, aucun service avec `active = TRUE`

**Vérifications :**
- [ ] `services = []` (tableau vide, pas absent)
- [ ] Clé `services` **présente** dans la réponse (différent du cas non-coach)

---

## TC-12 — Profil non-coach : clé services absente

**Précondition :** `role = "user"` (ou `"admin"`)

**Vérifications :**
- [ ] Clé `services` **absente** de la réponse JSON (pas `null`, pas `[]`)

---

## TC-13 — next_session_date : événement récurrent (weekly)

**Précondition :** tag_point avec `event_schedule = {"type": "weekly", "schedule": {"1": [{"start": "07:00"}]}}` (mardi 7h)

**Vérifications :**
- [ ] `next_session_date` = prochaine date de mardi à venir au format `"YYYY-MM-DD"`
- [ ] Calcul en fuseau `Europe/Paris`
- [ ] Si on est un mardi après 7h Paris → retourne le mardi suivant (J+7)

---

## TC-14 — next_session_date : événement ponctuel passé

**Précondition :** tag_point avec `event_date = <date dans le passé>`, `active = TRUE`

**Vérifications :**
- [ ] `next_session_date = null` (événement passé)
- [ ] `active = TRUE` donc le tag_point apparaît quand même dans la liste

---

## TC-15 — Compatibilité croisée Python → Java

**Objectif :** Même token JWT émis par Python → même réponse depuis Java

**Procédure :**
1. Appel `GET /api/users/{user_id}/public` (Python)
2. Même appel (Java)
3. Comparer les réponses champ par champ

**Vérifications :**
- [ ] Tous les champs fixes identiques
- [ ] `avg_rating` avec même arrondi
- [ ] `next_session_date` identique (même fuseau)
- [ ] `is_full` identique
- [ ] `interests` dans le même ordre (trié par `tag_id = ANY(...)` — ordre PostgreSQL)

---

## Résumé des cas

| # | Scénario | Résultat attendu |
|---|---|---|
| TC-01 | Non-coach, sans reviews, sans token | 200 — pas de services, is_following=false |
| TC-02 | Coach complet, token valide, suiveur | 200 — tous champs, is_following=true |
| TC-03 | user_id inexistant | 404 User not found |
| TC-04 | Sans token | 200 — is_following=false |
| TC-05 | Token invalide | 200 — is_following=false (pas 401) |
| TC-06 | Consulte son propre profil | 200 — is_following=false |
| TC-07 | show_phone=true, phone=null DB | 200 — phone=null |
| TC-08 | show_reviews=true, 0 reviews | 200 — avg_rating=null, count=0 |
| TC-09 | max_participants=null | 200 — is_full=false |
| TC-10 | 0 votes | 200 — rating=0, vote_count=0 |
| TC-11 | Coach, 0 services actifs | 200 — services=[] |
| TC-12 | Non-coach | 200 — clé services ABSENTE |
| TC-13 | Weekly schedule | 200 — next_session_date calculée Paris |
| TC-14 | Event_date passé | 200 — next_session_date=null |
| TC-15 | Compat Python→Java | 200 — réponses identiques |
