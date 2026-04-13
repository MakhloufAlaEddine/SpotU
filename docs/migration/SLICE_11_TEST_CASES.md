# SLICE_11_TEST_CASES.md — Cas de test
> Basé sur `booking_routes.py:1035–1110`.
> Généré le 2026-02-XX.

---

## GET /api/bookings/me (et alias /api/users/me/bookings)

### TC-M01 — Nominal
```
GET /api/bookings/me
Authorization: Bearer <token_user_A>
→ HTTP 200
→ Liste de bookings où b.user_id = user_A
→ Triés par created_at DESC
→ Champs présents : 22 BOOKING_FIELDS + service_title, address, receiver_name, receiver_picture, slot_start_time, slot_end_time, slot_date, slot_type
```

### TC-M02 — Liste vide (aucun booking)
```
GET /api/bookings/me
Authorization: Bearer <token_user_sans_booking>
→ HTTP 200
→ []
```

### TC-M03 — Alias actif
```
GET /api/users/me/bookings
Authorization: Bearer <token_user_A>
→ HTTP 200
→ Réponse identique à GET /api/bookings/me avec le même token
```

### TC-M04 — Booking sans slot (slot_id = null)
```
→ HTTP 200
→ slot_start_time = null, slot_end_time = null, slot_date = null, slot_type = null
→ Pas d'erreur de JOIN (LEFT JOIN)
```

### TC-M05 — Booking avec service supprimé (service_id = null ou service inexistant)
```
→ HTTP 200
→ service_title = null, address = null (LEFT JOIN → pas d'erreur)
```

### TC-M06 — pricing_snapshot comme string legacy
```
(booking créé avec pricing_snapshot stocké en chaîne JSON)
→ HTTP 200
→ pricing_snapshot retourné comme objet JSON (pas comme string)
→ Pas d'erreur de parsing
```

### TC-M07 — pricing_snapshot null
```
→ HTTP 200
→ pricing_snapshot = null dans la réponse (pas d'objet vide {})
```

### TC-M08 — Token absent
```
GET /api/bookings/me
(sans header Authorization)
→ HTTP 401
→ {"detail": "Non authentifié"} (ou équivalent selon require_auth)
```

### TC-M09 — Token invalide/expiré
```
GET /api/bookings/me
Authorization: Bearer INVALID_TOKEN
→ HTTP 401
```

### TC-M10 — Tri vérifié
```
(user avec plusieurs bookings à différentes dates)
→ Le booking le plus récent (created_at max) est le premier dans la liste
→ Ordre DESC confirmé
```

### TC-M11 — receiver_user_id null, coach_id rempli (legacy)
```
(ancien booking avec receiver_user_id=null, coach_id=usr_coach)
→ HTTP 200
→ receiver_name et receiver_picture remplis depuis u_recv (via COALESCE)
→ Pas de null car coach_id utilisé comme fallback
```

### TC-M12 — Compatibilité champs Python
```
Vérifier que le JSON Java contient exactement les mêmes clés que Python
Pas de champ supplémentaire (ex: pas de "id" doublon de "booking_id")
Noms snake_case identiques
```

---

## GET /api/bookings/received (et alias /api/receiver/requests)

### TC-R01 — Nominal
```
GET /api/bookings/received
Authorization: Bearer <token_coach_B>
→ HTTP 200
→ Liste de bookings où b.receiver_user_id = coach_B
→ Triés par created_at DESC
→ Champs : 22 BOOKING_FIELDS + service_title, payer_name
→ ABSENTS : address, receiver_name, receiver_picture, payer_picture, slot_*
```

### TC-R02 — Liste vide
```
→ HTTP 200
→ []
```

### TC-R03 — Alias actif
```
GET /api/receiver/requests
Authorization: Bearer <token_coach_B>
→ HTTP 200
→ Identique à /bookings/received
```

### TC-R04 — Absence des champs slot (pas de JOIN service_slots)
```
→ HTTP 200
→ Vérifier que slot_start_time, slot_end_time, slot_date, slot_type
   sont ABSENTS de la réponse (pas null — absents)
```

### TC-R05 — payer_name avec payer_user_id = null (ancien booking)
```
(booking avec payer_user_id=null)
→ payer_name = null (LEFT JOIN sans COALESCE sur /received)
→ Pas d'erreur
```

### TC-R06 — Token absent/invalide
```
→ HTTP 401
```

### TC-R07 — Différence /me vs /received
```
Un même utilisateur qui est à la fois payer d'un booking X et receiver d'un booking Y :
- GET /bookings/me → contient X, pas Y
- GET /bookings/received → contient Y, pas X
Vérifier cette asymétrie de filtrage
```

---

## GET /api/bookings/{booking_id}

### TC-D01 — Nominal (payer)
```
GET /api/bookings/<booking_id>
Authorization: Bearer <token_payer>  (user_id ou payer_user_id du booking)
→ HTTP 200
→ Objet complet avec les 22 BOOKING_FIELDS
→ + service_title, address, service_images, service_description
→ + receiver_name, receiver_picture, payer_name, payer_picture
→ + slot_start_time, slot_end_time, slot_date, slot_type
```

### TC-D02 — Nominal (receiver/coach)
```
GET /api/bookings/<booking_id>
Authorization: Bearer <token_receiver>  (receiver_user_id ou coach_id du booking)
→ HTTP 200
→ Même réponse complète
```

### TC-D03 — Nominal (admin)
```
GET /api/bookings/<any_booking_id>
Authorization: Bearer <token_admin>  (role=admin)
→ HTTP 200
→ Même réponse même si l'admin n'est pas dans les 4 champs
```

### TC-D04 — Booking introuvable
```
GET /api/bookings/bk_inexistant
Authorization: Bearer <token_valide>
→ HTTP 404
→ {"detail": "Réservation introuvable"}
```

### TC-D05 — Accès refusé (utilisateur tiers)
```
GET /api/bookings/<booking_id>
Authorization: Bearer <token_tiers>  (user_id pas dans {user_id, payer_user_id, receiver_user_id, coach_id})
→ HTTP 403
→ {"detail": "Accès refusé"}
```

### TC-D06 — Token absent
```
→ HTTP 401
```

### TC-D07 — booking avec receiver_user_id=null, coach_id rempli
```
(COALESCE receiver)
→ HTTP 200
→ receiver_name/picture chargés via coach_id
→ Contrôle d'accès inclut coach_id dans le Set
```

### TC-D08 — booking avec payer_user_id=null, user_id rempli (legacy)
```
(COALESCE payer)
→ HTTP 200
→ payer_name/picture chargés via user_id
→ Contrôle d'accès inclut user_id dans le Set
```

### TC-D09 — pricing_snapshot parsé correctement
```
→ Objet JSON (pas string) dans la réponse
```

### TC-D10 — service_images format array
```
(service avec images JSONB = ["url1", "url2"])
→ service_images retourné comme array JSON
→ Pas de double-parsing
```

---

## Cas transversaux

### TC-X01 — Compatibilité Python vs Java
```
Appel simultané Python et Java avec même token :
GET /api/bookings/me
GET /api/bookings/received
GET /api/bookings/<booking_id>
→ JSON structurellement identique (mêmes clés, même tri, mêmes valeurs)
```

### TC-X02 — Champs absents vs null
```
/bookings/received ne contient pas address, slot_*, receiver_*
→ Ces champs sont ABSENTS du JSON (ne pas retourner "address": null)
→ Vérifier strictement l'absence (pas la nullité)
```

### TC-X03 — Pas de fuite entre users
```
User A ne voit pas les bookings de user B dans GET /bookings/me
(même si B a passé des bookings sur les mêmes services)
```

### TC-X04 — Tous les statuts visibles
```
GET /bookings/me avec bookings en requested, confirmed, cancelled, expired
→ Tous retournés (pas de filtre sur status)
```
