# SLICE_09_TEST_CASES.md — Cas de test
> Basé sur `service_routes.py:352–413`, `service_routes.py:718–753`.
> Compatibilité stricte Python requise.
> Généré le 2026-02-XX.

---

## GET /api/services

### TC-01 — Nominal : sans filtre, sans token

**Requête :**
```http
GET /api/services
```

**Réponse attendue : HTTP 200, tableau de services actifs (max 100)**

**Vérifications :**
- [ ] HTTP 200
- [ ] Tableau (vide `[]` si aucun service actif, sinon N items)
- [ ] Chaque item contient : service_id, title, price, coach{}, avg_rating, review_count, locations[], tags[], slots=[], packages=[], is_owner=false
- [ ] `active=true` pour chaque service
- [ ] `slots = []` et `packages = []` pour chaque service
- [ ] `is_owner = false` pour chaque service

---

### TC-02 — Filtre coach_id : services d'un coach spécifique

**Requête :**
```http
GET /api/services?coach_id=user_coach001
```

**Vérifications :**
- [ ] HTTP 200
- [ ] Tous les services ont `coach_id = "user_coach001"`
- [ ] Services inactifs absents (`active=true` uniquement)

---

### TC-03 — Token valide : propres services exclus

**Précondition :** Coach `user_coach001` a 2 services actifs. Pas de filtre `coach_id`.

**Requête :**
```http
GET /api/services
Authorization: Bearer <valid_jwt_coach001>
```

**Vérifications :**
- [ ] Services de `user_coach001` absents du résultat
- [ ] Services des autres coachs présents
- [ ] HTTP 200

---

### TC-04 — Token invalide : tous les services présents (pas d'exclusion)

**Requête :**
```http
GET /api/services
Authorization: Bearer invalid.token.here
```

**Vérifications :**
- [ ] HTTP 200 (pas 401)
- [ ] Services de tous les coachs présents (pas d'exclusion par coach_id)

---

### TC-05 — Filtre domain_id

**Requête :**
```http
GET /api/services?domain_id=dom_sport
```

**Vérifications :**
- [ ] Tous les services ont `domain_id = "dom_sport"`
- [ ] HTTP 200

---

### TC-06 — Aucun service actif correspondant aux filtres

**Requête :**
```http
GET /api/services?coach_id=user_sans_service
```

**Réponse attendue : HTTP 200, `[]`**

---

### TC-07 — Vérification enrichissement coach

**Précondition :** Service avec `coach_id = user_coach001`

**Vérifications :**
- [ ] `coach.user_id = "user_coach001"`
- [ ] `coach.name` présent
- [ ] `coach.picture` présent (null ou string)
- [ ] `coach.is_coach_verified` présent (boolean)
- [ ] `coach` contient exactement 4 champs (pas d'email, pas d'iban)

---

### TC-08 — avg_rating par coach (pas par service)

**Précondition :** Coach `user_coach001` a 2 services actifs et 5 reviews

**Vérifications :**
- [ ] Les 2 services retournent le même `avg_rating`
- [ ] Les 2 services retournent le même `review_count`
- [ ] Si coach sans reviews : `avg_rating = null`, `review_count = 0`

---

### TC-09 — images JSONB parsé en liste

**Vérifications :**
- [ ] `images` est un tableau JSON (pas une string JSON)
- [ ] `images = []` si null en DB (pas null)

---

## GET /api/services/{service_id}

### TC-10 — Nominal : service existant, sans token

**Requête :**
```http
GET /api/services/svc_abc123
```

**Vérifications :**
- [ ] HTTP 200
- [ ] `is_owner = false`
- [ ] `slots[]` présent et non vide (si créneaux futurs existants)
- [ ] `packages[]` présent (vide ou non)
- [ ] `original_address` absent
- [ ] Chaque `location` n'a pas de `original_description`

---

### TC-11 — Vue propriétaire (token du coach)

**Requête :**
```http
GET /api/services/svc_abc123
Authorization: Bearer <valid_jwt_coach001>
```
(où `svc_abc123.coach_id = user_coach001`)

**Vérifications :**
- [ ] `is_owner = true`
- [ ] `original_address` présent si precision ≠ exact
- [ ] `locations[].original_description` présent si precision ≠ exact

---

### TC-12 — Vue admin

**Requête :**
```http
GET /api/services/svc_abc123
Authorization: Bearer <valid_jwt_admin>
```
(admin d'un autre coach)

**Vérifications :**
- [ ] `is_owner = true` (admin voit comme propriétaire)

---

### TC-13 — service_id inexistant

**Requête :**
```http
GET /api/services/svc_inexistant
```

**Réponse attendue : HTTP 404**
```json
{"detail": "Service not found"}
```

---

### TC-14 — Slots filtrés : passé absent, futur présent

**Précondition :** Service avec 1 slot passé + 1 slot futur

**Vérifications :**
- [ ] Slot passé absent de `slots[]`
- [ ] Slot futur présent dans `slots[]`

---

### TC-15 — Slots filtrés : réservé = absent

**Précondition :** Service avec 1 slot futur ayant une réservation `status=confirmed`

**Vérifications :**
- [ ] Ce slot absent de `slots[]` (réservé)

---

### TC-16 — Cohérence Slice 04 (profil public services[])

**Procédure :**
1. `GET /api/users/user_coach001/public` → noter `services[0].service_id`
2. `GET /api/services/svc_abc123` (le même service)

**Vérifications :**
- [ ] Le service_id est présent dans les deux
- [ ] Le service Slice 09 a plus de champs (coach, avg_rating, locations, tags, slots, packages)

---

## Résumé des cas

| # | Endpoint | Scénario | Résultat attendu |
|---|---|---|---|
| TC-01 | /services | Sans filtre, sans token | 200 — tous services actifs |
| TC-02 | /services | Filtre coach_id | 200 — services du coach |
| TC-03 | /services | Token valide, coach | 200 — propres services exclus |
| TC-04 | /services | Token invalide | 200 (pas 401) |
| TC-05 | /services | Filtre domain_id | 200 — filtrés par domaine |
| TC-06 | /services | Aucun résultat | 200 — `[]` |
| TC-07 | /services | Enrichissement coach | 4 champs exactement |
| TC-08 | /services | avg_rating par coach | Cohérence entre services |
| TC-09 | /services | images JSONB | Tableau, jamais string |
| TC-10 | /services/{id} | Nominal sans token | 200 — is_owner=false, slots chargés |
| TC-11 | /services/{id} | Token coach propriétaire | 200 — is_owner=true, original visible |
| TC-12 | /services/{id} | Token admin | 200 — is_owner=true |
| TC-13 | /services/{id} | service_id inexistant | 404 |
| TC-14 | /services/{id} | Slots filtrés passé | Passé absent |
| TC-15 | /services/{id} | Slot réservé | Absent de slots[] |
| TC-16 | Cross | Cohérence Slice 04 | service_id présent dans les deux |
