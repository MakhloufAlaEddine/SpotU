# SLICE_04_SCOPE.md — Cadrage de la Slice 04
> Basé sur `user_routes.py:99–235`, `spot_you_routes.py:27–109`, `auth_utils.py`.
> Généré le 2026-02-XX.

---

## Identification de l'endpoint

| Nom dans la mission | Endpoint Python réel | Handler |
|---|---|---|
| Profil public d'un autre utilisateur | `GET /api/users/{user_id}/public` | `get_public_profile` — `user_routes.py:99` |

**Le chemin Python est déjà canonique.** Aucun renommage recommandé côté Java.
Java cible : `GET /api/users/{userId}/public`

---

## Endpoint inclus dans cette slice

| # | Méthode | Chemin Python (prod) | Chemin Java (cible) | Fichier Python | Ligne |
|---|---|---|---|---|---|
| 1 | GET | `/api/users/{user_id}/public` | `/api/users/{userId}/public` | `user_routes.py` | 99–235 |

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `PUT /api/users/profile` | Mutation profil — Slice 3+ |
| `GET /api/users/{user_id}/reviews` | Liste complète des reviews d'un user — Slice 5+ |
| `POST/DELETE /api/users/{user_id}/follow` | Write — Slice 5+ |
| `POST/DELETE /api/users/{user_id}/block` | Write — Slice 5+ |
| `GET /api/users/{user_id}/followers` | Liste détaillée abonnés — Slice 5+ |
| `GET /api/users/{user_id}/following` | Liste détaillée abonnements — Slice 5+ |
| `GET /api/users/{user_id}/suggestions` | Algorithme complexe — Slice 5+ |
| `PATCH /api/users/{user_id}/cover` | Write + upload — Slice 4 upload |
| `GET /api/services` | Services listés séparément — Slice 8 |
| `GET /api/tag-points` | SpotYous complets — Slice 6 |

---

## Dépendances exactes

### Ce qui doit déjà exister côté Java avant d'implémenter cette slice

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| Connexion PostgreSQL (Supabase) | Infrastructure | OUI | Hérité des slices précédentes |
| `JwtAuthFilter` + lecture optionnelle du token | Auth | OUI | Auth optionnelle : ne pas rejeter les requêtes sans token |
| Table `users` accessible | DB | OUI | 13 colonnes spécifiques (différentes de USER_FIELDS) |
| Table `user_follows` accessible | DB | OUI | Counts abonnés + is_following |
| Table `tags` accessible | DB | OUI | Détails tags (label_fr, label_en, icon) pour interests |
| Table `reviews` accessible | DB | OUI | Conditional si show_reviews=true |
| Table `services` accessible | DB | OUI | Conditional si role=coach |
| Table `tag_points` accessible | DB | OUI | Derniers 20 SpotYou actifs du profil |
| Table `spot_you_members` accessible | DB | OUI | Batch participants_count |
| Table `spot_you_attendance` accessible | DB | OUI | Batch going_count |
| Table `tag_point_votes` accessible | DB | OUI | Batch rating + vote_count |
| Utilitaire `get_next_session_date` | Service | OUI | Logique de calcul date prochaine séance — voir `spot_you_routes.py:27–109` |

### Absence de dépendances (confirmé)

- Pas de bcrypt
- Pas de Stripe
- Pas d'upload / R2
- Pas de workers
- Pas de WebSocket
- Pas de push notifications
- Pas d'écriture en DB

---

## Niveau de risque

**MOYEN.**

Points de risque :
1. **Auth optionnelle** : ne pas renvoyer 401 si token absent — comportement différent des slices précédentes
2. **11 requêtes DB** (vs 1 pour Slice 02, 3 pour Slice 03) — toutes dans la même transaction
3. **Logique `get_next_session_date`** : algo non trivial importé depuis `spot_you_routes.py` — doit être répliqué fidèlement (fuseau Paris, weekday 0=Lun, gestion cas limites)
4. **Conditional branches** : services uniquement si coach, reviews uniquement si show_reviews, phone masqué si !show_phone
5. **JSONB double-parse protection** : `coach_tags` peut arriver en string doublement encodée — pattern Python spécifique

---

## Lien avec Slice 03 (`GET /api/users/me` = `/api/users/profile`)

| Aspect | Slice 03 `GET /api/users/me` | Slice 04 `GET /api/users/{userId}/public` |
|---|---|---|
| Auth | **Obligatoire** | **Optionnelle** |
| Colonnes DB users | USER_FIELDS (18) | 13 colonnes spécifiques |
| Données bancaires (IBAN) | **OUI** | **NON — jamais exposées** |
| Phone | Toujours exposé | Masqué si `show_phone=false` |
| Reviews | Toujours calculées | Conditionnelles (`show_reviews`) |
| Email, language, goals, user_roles | OUI | **NON** |
| cover_picture, cover_offset_y, cover_scale | NON | **OUI** |
| followers_count, following_count | NON | **OUI** |
| is_following | NON | **OUI** (si auth) |
| interests (tag details) | NON | **OUI** |
| services (si coach) | NON | **OUI** |
| tag_points (SpotYous enrichis) | NON | **OUI** |
| Requêtes DB | 3 | **11** |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Auth optionnelle — ne pas retourner 401 | Python `user_routes.py:103–107` fait un try/except sur `require_auth`. Si le token est absent ou invalide, `me_id = None`. Java doit reproduire ce comportement : token invalide → `me_id = null`, pas une erreur 401. |
| P2 | `get_next_session_date` — timezone Paris obligatoire | La fonction compare les heures en fuseau `Europe/Paris`. Utiliser `UTC` côté Java serait un bug silencieux. Voir `spot_you_routes.py:36–38`. |
| P3 | JSONB coach_tags double-parse | `user_routes.py:146–151` : si `coach_tags` arrive en string, il est parsé en JSON. Peut arriver en DB legacy. Java doit gérer `String` ou `List` pour ce champ. |
| P4 | `show_phone` / `show_reviews` dans la réponse | Ces flags sont dans le SELECT (colonnes renvoyées) — ils apparaissent dans la réponse JSON finale. Ne pas les supprimer. |
| P5 | `is_full` — dépend de `going_count` et `maximum_participants` | `is_full = maximum_participants IS NOT NULL AND going_count >= maximum_participants` (`user_routes.py:230–231`). Si `maximum_participants` est null → `is_full = false` (jamais true). |
| P6 | `services` absent si non-coach | Le champ `services` n'est ajouté au dict que si `role == "coach"`. Si `role != "coach"`, la clé est **absente** de la réponse (pas `null`, pas `[]`). |
