# SLICE_26_TEST_CASES.md — Cas de tests
> Généré le 2026-04-15.

---

## A. GET /tag-points (Search)

### TC-SR-01 — Recherche nominale avec géo
```
GIVEN : 5 SpotYou actifs à Paris
WHEN  : GET /api/tag-points?lat=48.8566&lng=2.3522&radius=10000
THEN  : 200 + array triée par distance, chaque item a distance, owner object, location GeoJSON
```

### TC-SR-02 — Sans coordonnées → tous les actifs
```
WHEN  : GET /api/tag-points
THEN  : 200 + array sans distance (null), pas de tri spatial, LIMIT 200
```

### TC-SR-03 — Filtre domain_id
```
WHEN  : GET /api/tag-points?domain_id=dom_001
THEN  : 200 + seulement les SpotYou du domaine dom_001
```

### TC-SR-04 — Filtre tag_ids (virgules)
```
WHEN  : GET /api/tag-points?tag_ids=tag_001,tag_002
THEN  : 200 + SpotYou ayant au moins tag_001 OU tag_002 (?| operator)
```

### TC-SR-05 — Exclut ses propres SpotYou (connecté)
```
GIVEN : user connecté a créé sp_001
WHEN  : GET /api/tag-points (avec auth)
THEN  : sp_001 absent du résultat
```

### TC-SR-06 — Anonyme → inclut tout
```
WHEN  : GET /api/tag-points (sans auth)
THEN  : tous les SpotYou actifs inclus
```

### TC-SR-07 — Precision masking 100m
```
GIVEN : SpotYou sp_002 avec precision="100m", lat réel=48.8566
WHEN  : GET /api/tag-points (pas owner)
THEN  : sp_002.latitude ≠ 48.8566 (décalé), sp_002.longitude ≠ réel
```

### TC-SR-08 — Aucun résultat → []
```
WHEN  : GET /api/tag-points?lat=0&lng=0&radius=1
THEN  : 200 + []
```

---

## B. GET /tag-points/mine

### TC-MY-01 — Mes SpotYou nominaux
```
GIVEN : user a 3 SpotYou actifs
WHEN  : GET /api/tag-points/mine
THEN  : 200 + array de 3, chacun avec participants_count, next_session_date, going_count, is_going, is_full, can_participate=true
```

### TC-MY-02 — Aucun SpotYou → []
```
GIVEN : user sans SpotYou
WHEN  : GET /tag-points/mine
THEN  : 200 + []
```

### TC-MY-03 — Auth absente → 401
```
WHEN  : GET /tag-points/mine (sans auth)
THEN  : 401
```

---

## C. GET /tag-points/saved

### TC-SV-01 — Sauvegardés nominaux
```
GIVEN : user a sauvegardé 2 SpotYou
WHEN  : GET /api/tag-points/saved
THEN  : 200 + array de 2, triés par saved_at DESC, enrichis
```

### TC-SV-02 — Auth absente → 401
```
WHEN  : GET /tag-points/saved (sans auth)
THEN  : 401
```

---

## D. GET /tag-points/{point_id} (Détail)

### TC-DT-01 — Détail nominal (anonyme)
```
GIVEN : sp_001 actif
WHEN  : GET /api/tag-points/sp_001 (sans auth)
THEN  : 200 + détail complet avec tags, rating, votes, rating_distribution, participants_count
AND   : is_going=false, is_saved=false, is_member=false, join_status=null
```

### TC-DT-02 — Détail (connecté, membre)
```
GIVEN : user membre de sp_001
WHEN  : GET /tag-points/sp_001 (avec auth)
THEN  : 200 + is_participant=true, is_member=true, can_participate=true, join_status="accepted"
AND   : going_count visible (si next_session_date existe)
```

### TC-DT-03 — Détail (connecté, going)
```
GIVEN : user going pour la prochaine session de sp_001
WHEN  : GET /tag-points/sp_001
THEN  : is_going=true
```

### TC-DT-04 — Point inexistant → 404
```
WHEN  : GET /tag-points/nonexistent
THEN  : 404 "TagPoint not found"
```

### TC-DT-05 — SpotYou inactif + non-owner → 404
```
GIVEN : sp_002 active=false, user != owner
WHEN  : GET /tag-points/sp_002
THEN  : 404 "SpotYou non disponible"
```

### TC-DT-06 — SpotYou inactif + owner → 200
```
GIVEN : sp_002 active=false, user = owner
WHEN  : GET /tag-points/sp_002 (avec auth owner)
THEN  : 200 + détail complet, is_owner=true
```

### TC-DT-07 — Owner voit original_address
```
GIVEN : sp_003 precision="100m", address="12 rue de la Paix"
WHEN  : GET /tag-points/sp_003 (owner)
THEN  : address = masquée, original_address = "12 rue de la Paix"
```

### TC-DT-08 — Join status "pending"
```
GIVEN : user a fait JOIN avec status pending
WHEN  : GET /tag-points/sp_001
THEN  : join_status="pending", is_participant=false
```

---

## E. GET /tag-points/{point_id}/similar

### TC-SM-01 — Similaires par tags
```
GIVEN : sp_001 a tags ["yoga"], sp_002 aussi, sp_003 a tags ["football"]
WHEN  : GET /api/tag-points/sp_001/similar
THEN  : sp_002 en premier (tags match), sp_003 possible si < 10km
```

### TC-SM-02 — Point inexistant → []
```
WHEN  : GET /tag-points/nonexistent/similar
THEN  : 200 + []
```

### TC-SM-03 — Max 10 résultats
```
GIVEN : 20 SpotYou similaires
WHEN  : GET /tag-points/sp_001/similar
THEN  : 200 + array de 10 max
```

---

## F. GET /tag-points/{point_id}/participants

### TC-PT-01 — Liste nominale
```
GIVEN : sp_001 a 5 membres acceptés
WHEN  : GET /api/tag-points/sp_001/participants
THEN  : 200 + array de 5 { user_id, name, picture, role, is_creator }
AND   : créateur en position 0
```

### TC-PT-02 — Public (pas d'auth nécessaire)
```
WHEN  : GET /tag-points/sp_001/participants (sans auth)
THEN  : 200 (pas de 401)
```

---

## G. GET /users/me/pending-requests

### TC-PR-01 — Demandes en attente
```
GIVEN : user a 2 demandes pending pour sp_001 et sp_002
WHEN  : GET /api/users/me/pending-requests
THEN  : 200 + array de 2, chacun enrichi avec join_status="pending" et requested_at
```

### TC-PR-02 — Aucune demande → []
```
WHEN  : GET /users/me/pending-requests
THEN  : 200 + []
```

### TC-PR-03 — Auth absente → 401
```
WHEN  : GET /users/me/pending-requests (sans auth)
THEN  : 401
```

---

## Résumé

| Catégorie | Nombre | Couverture |
|---|---|---|
| A. Search | 8 | Géo, sans coords, filtres, exclusion, precision, vide |
| B. Mine | 3 | Nominal, vide, auth |
| C. Saved | 2 | Nominal, auth |
| D. Detail | 8 | Anonyme, membre, going, 404, inactif, owner, address, pending |
| E. Similar | 3 | Tags, inexistant, limit |
| F. Participants | 2 | Nominal, public |
| G. Pending | 3 | Nominal, vide, auth |
| **TOTAL** | **29** | |
