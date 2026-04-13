# SLICE_09_SCOPE.md — Cadrage de la Slice 09
> Basé sur `service_routes.py:1–420`, `service_routes.py:718–753`, `server.py:100`.
> Généré le 2026-02-XX.

---

## Endpoints inclus dans cette slice

| # | Méthode | Chemin Python | Chemin Java (cible) | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/services` | `/api/services` | `service_routes.py` | 352–413 |
| 2 | GET | `/api/services/{service_id}` | `/api/services/{serviceId}` | `service_routes.py` | 718–736 |

**Note de montage :** `service_router` est inclus sans préfixe dans `server.py:100` → routes directement sous `/api/`.

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `GET /api/services/mine` | Auth stricte — vue propriétaire — Slice 10 |
| `GET /api/services/saved` | Auth stricte — services sauvegardés — Slice 10 |
| `GET /api/services/deactivated` | Auth stricte — services désactivés — Slice 10 |
| `POST /api/services` | Création — auth stricte + uploads — Slice 11+ |
| `PUT/PATCH /api/services/{id}` | Modification — auth stricte — Slice 11+ |
| `DELETE /api/services/{id}` | Suppression — auth stricte — Slice 11+ |
| `POST /api/services/{id}/reactivate` | Action — auth stricte — Slice 11+ |
| `POST /api/services/{id}/save` | Sauvegarde — auth stricte — Slice 10 |

---

## Auth

### GET /api/services — Soft auth (inline try/except)

```python
# service_routes.py:364–371
current_user_id = None
try:
    token = get_token_from_request(request)
    if token:
        payload = decode_jwt(token)
        current_user_id = payload.get("user_id")
except Exception:
    pass
```

- Token valide → `current_user_id` = user_id de l'appelant (ses propres services exclus des résultats)
- Token absent / invalide → `current_user_id = None` → aucune exclusion, tous les services retournés
- **Jamais de 401**

### GET /api/services/{service_id} — Auth optionnelle (`get_optional_auth`)

- Token valide → `viewer` dict → `is_owner` calculé
- Token absent / invalide → `viewer = None` → `is_owner = False`
- **Jamais de 401**
- Le résultat parallélise `_fetch_row()` et `get_optional_auth` via `asyncio.gather`

---

## Dépendances exactes

| Dépendance | Type | Endpoint | Détail |
|---|---|---|---|
| Table `services` | DB | Les deux | SVC_FIELDS (18 colonnes) |
| Table `users` | DB | Les deux | Coach info (4 colonnes) |
| Table `reviews` | DB | Les deux | avg_rating + review_count par coach_id |
| Table `service_locations` | DB | Les deux | Adresses masquées, PostGIS (latitude/longitude) |
| Table `tags` | DB | Les deux | Détail des tags associés |
| Table `service_slots` | DB | GET /detail uniquement | Créneaux futurs sans réservation active |
| Table `service_packages` | DB | GET /detail uniquement | Formules avec leurs créneaux |
| Table `bookings` | DB | GET /detail uniquement | Filtrage indirect des slots réservés |
| Extension PostGIS | DB | GET /services (geo) | `ST_DWithin`, `ST_SetSRID`, `ST_MakePoint` |
| `app_config` | DB | NON — non lu en GET | Lue uniquement lors des writes |

---

## Niveau de risque

**MOYEN.**

Points de risque :
1. **PostGIS** — `ST_DWithin` dans la requête géo : nécessite l'extension PostGIS active sur le JDBC driver et Hibernate. Utiliser une requête SQL native.
2. **Masquage d'adresses** (`_mask_address`) — logique Python non triviale à reproduire en Java (regex, parcours arrière des parties)
3. **4 requêtes batch asyncio.gather** (liste) / **7+ requêtes batch** (detail) — en Java, utiliser des CompletableFuture ou des requêtes séquentielles (acceptable pour v1)
4. **slots = [] intentionnellement** dans la vue liste — ne pas charger les slots pour `GET /api/services`
5. **is_owner** conditionnel sur viewer.user_id == svc.coach_id OR viewer.role == "admin"

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | `slots=[]` et `packages=[]` dans la liste | `GET /api/services` retourne toujours `slots=[]` et `packages=[]` — intentionnel pour la performance. Seul `GET /services/{id}` charge les vrais slots/packages. |
| P2 | Masquage d'adresse (precision 100m/1000m) | Logique Python dans `_mask_address` (ligne 68) — regex complexe. Doit être reproduite fidèlement en Java. Pour v1, retourner la description DB sans masquage peut être un workaround accepté (à documenter). |
| P3 | Propres services exclus si authentifié | `GET /api/services` avec token valide → `coach_id != current_user_id`. Un coach authentifié ne voit pas ses propres services dans la recherche. |
| P4 | `avg_rating` par `coach_id` (pas `service_id`) | Les reviews sont calculées par `reviewee_id = coach_id`. Plusieurs services d'un même coach partagent le même `avg_rating`. |
| P5 | Slots filtrés (future + pas de booking actif) | La query slots exclut les créneaux passés ET ceux avec une réservation `pending/accepted/awaiting_payment/confirmed`. Logique JOIN EXISTS sur `bookings`. |
| P6 | `is_owner = True` pour `role="admin"` aussi | Un admin voit l'adresse originale même s'il n'est pas le coach propriétaire. |
| P7 | `booking_approval_mode` non normalisé en GET | La normalisation (`_normalize_booking_config`) est appelée uniquement lors des writes (create/update). Le GET retourne la valeur brute DB. |
