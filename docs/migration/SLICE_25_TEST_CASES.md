# SLICE_25_TEST_CASES.md — Cas de tests
> Basé sur `home_routes.py`.
> Généré le 2026-04-15.

---

## A. GET /home/nearest-sector

### TC-NS-01 — Secteur le plus proche nominal

```
GIVEN : SpotYou actifs en DB, user position Paris (48.8566, 2.3522)
WHEN  : GET /api/home/nearest-sector?lat=48.8566&lng=2.3522
THEN  : 200 + { lat, lng, distance_km, spot_count }
AND   : distance_km est la distance au SpotYou le plus proche
AND   : spot_count = nombre de SpotYou à 50 km du point trouvé
```

### TC-NS-02 — Aucun SpotYou actif → null

```
GIVEN : aucun tag_point avec active=true
WHEN  : GET /home/nearest-sector?lat=48.8&lng=2.3
THEN  : 200 + null
```

### TC-NS-03 — Exclut le user connecté

```
GIVEN : seul SpotYou actif = celui du user connecté
WHEN  : GET /home/nearest-sector?lat=48.8&lng=2.3 (avec auth)
THEN  : 200 + null (exclu par tp.user_id != $3)
```

### TC-NS-04 — Sans auth → inclut tous les SpotYou

```
GIVEN : seul SpotYou actif = celui de user_001
WHEN  : GET /home/nearest-sector?lat=48.8&lng=2.3 (SANS auth)
THEN  : 200 + résultat (pas d'exclusion)
```

---

## B. GET /home/feed

### TC-FD-01 — Feed nominal avec géolocalisation

```
GIVEN : 5 SpotYou actifs + 3 services actifs à Paris, user connecté avec tags
WHEN  : GET /api/home/feed?lat=48.8566&lng=2.3522 (auth)
THEN  : 200 + { spotyou: [...], services: [...], actual_radius_km: 50, is_expanded: false, has_personalization: true, total_count: 8 }
AND   : spotyou trié par score DESC
AND   : services trié par score DESC
AND   : chaque service a un objet `coach: { user_id, name, picture }`
```

### TC-FD-02 — Feed anonyme (sans auth)

```
WHEN  : GET /home/feed?lat=48.8&lng=2.3 (SANS auth)
THEN  : 200 + { has_personalization: false, ... }
AND   : is_going = false pour tous les SpotYou
AND   : scoring par distance + popularité uniquement (pas de tags communs ni bonus membre)
```

### TC-FD-03 — Feed sans coordonnées

```
WHEN  : GET /home/feed (pas de lat/lng)
THEN  : 200 + { spotyou: [...], services: [...], actual_radius_km: 50 }
AND   : distance = null pour tous les items
AND   : pas de filtre géo (tous les actifs retournés)
```

### TC-FD-04 — Auto-expansion rayon

```
GIVEN : 0 SpotYou + 0 services à 50 km, 5 SpotYou à 150 km
WHEN  : GET /home/feed?lat=48.8&lng=2.3
THEN  : 200 + actual_radius_km: 200, is_expanded: true
AND   : les 5 SpotYou à 150 km sont retournés (trouvés au rayon 200 km)
```

### TC-FD-05 — Auto-expansion complète (zone vide)

```
GIVEN : aucun SpotYou ni service actif à 500 km
WHEN  : GET /home/feed?lat=0&lng=0 (milieu océan)
THEN  : 200 + { spotyou: [], services: [], total_count: 0, actual_radius_km: 500, is_expanded: true }
```

### TC-FD-06 — Scoring : tags communs priorisés

```
GIVEN : user a coach_tags=["yoga"], SpotYou A tags=["yoga"], SpotYou B tags=["course"]
AND   : distance et popularité identiques
WHEN  : GET /home/feed
THEN  : SpotYou A avant SpotYou B (score tags communs +20)
```

### TC-FD-07 — Scoring : bonus membre

```
GIVEN : user est membre du SpotYou A, pas du SpotYou B
AND   : tout le reste égal
WHEN  : GET /home/feed
THEN  : SpotYou A avant SpotYou B (bonus +20)
```

### TC-FD-08 — is_going batch

```
GIVEN : user connecté, going pour SpotYou A (session_date=demain), pas pour SpotYou B
WHEN  : GET /home/feed
THEN  : SpotYou A.is_going = true, SpotYou B.is_going = false
```

### TC-FD-09 — is_full calculation

```
GIVEN : SpotYou avec maximum_participants=5, 5 going avec session_date >= today
WHEN  : GET /home/feed
THEN  : SpotYou.is_full = true
```

### TC-FD-10 — Exclut ses propres SpotYou et services

```
GIVEN : user connecté crée SpotYou A et Service X
WHEN  : GET /home/feed
THEN  : SpotYou A absent de la réponse, Service X absent
```

### TC-FD-11 — Services enrichis : objet coach

```
WHEN  : GET /home/feed
THEN  : chaque service a { coach: { user_id, name, picture } }
AND   : PAS de coach_name/coach_picture en champ plat
```

### TC-FD-12 — Limites : max 30 SpotYou + 20 services

```
GIVEN : 80 SpotYou actifs + 50 services actifs
WHEN  : GET /home/feed
THEN  : spotyou.length <= 30, services.length <= 20
```

### TC-FD-13 — JSONB tag_ids parsing

```
GIVEN : SpotYou avec tag_ids stocké comme '["tag_001","tag_002"]' (string JSONB)
WHEN  : GET /home/feed
THEN  : tag_ids dans la réponse est un ARRAY (pas un string)
```

---

## Résumé

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. nearest-sector | 4 | Nominal, vide, exclu user, sans auth |
| B. feed | 13 | Nominal, anonyme, sans coords, expansion, scoring, is_going, is_full, exclusion, coach, limites, JSONB |
| **TOTAL** | **17** | |
