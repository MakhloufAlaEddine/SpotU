# SLICE_03_SCOPE.md — Cadrage de la Slice 03
> Basé sur `user_routes.py:11–30`, `auth_utils.py:68–83`, `database.py`.
> Généré le 2026-02-XX.

---

## ATTENTION — Écart de nommage important

| Nom utilisé dans la mission | Endpoint Python réel | Handler |
|---|---|---|
| `GET /api/users/me` | `GET /api/users/profile` | `get_profile` — `user_routes.py:11` |

**Il n'existe pas de route `GET /api/users/me` dans le codebase Python.**

Le chemin `GET /api/users/profile` est l'équivalent fonctionnel.
Il est enregistré dans `server.py:95` : `api_router.include_router(user_router, prefix="/users")`.

**Recommandation pour Java :** Lors de la migration, renommer l'endpoint en `GET /api/users/me`
pour une meilleure cohérence REST. C'est le bon moment pour corriger ce nommage.
La cohabitation Python/Java impose de **choisir l'un des deux chemins** — pas les deux simultanément.

---

## Endpoint inclus dans cette slice

| # | Méthode | Chemin Python (prod) | Chemin Java (cible) | Fichier Python | Ligne |
|---|---|---|---|---|---|
| 1 | GET | `/api/users/profile` | `/api/users/me` (recommandé) | `user_routes.py` | 11–30 |

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `PUT /api/users/profile` | Mutation + validation nom + upload photo — Slice 3+ |
| `POST /api/users/become-coach` | Mutation de rôle — Slice 3+ |
| `GET /api/users/{user_id}/public` | Profil public d'un autre user — plus complexe (followers, SpotYou, services) |
| `GET /api/users/search` | Recherche par nom — Slice 3+ |
| `POST/DELETE /api/users/{user_id}/follow` | Système de suivi — Slice 3+ |
| `POST/DELETE /api/users/{user_id}/block` | Système de blocage — Slice 3+ |
| `PATCH /api/users/{user_id}/cover` | Upload cover photo — nécessite R2 (Slice 4) |
| `GET /api/users/me/activity-feed` | Agrégation SpotYou — nécessite Slice 6 |
| `GET /api/users/me/bookings` | Bookings — nécessite Slice 11 |
| `GET /api/users/me/notifications` | Notifications — Slice 15 |

---

## Dépendances exactes

### Ce qui doit déjà exister côté Java avant d'implémenter cette slice

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| `JwtAuthFilter` opérationnel | Auth | OUI | Hérité de Slice 02 — même filtre, rien à changer |
| `UserRepository` avec `USER_FIELDS` | Repository | OUI | 18 colonnes — hérité de Slice 02 |
| Connexion PostgreSQL (Supabase) | Infrastructure | OUI | Pool JDBC SSL — hérité de Slice 02 |
| `JWT_SECRET` identique | Config | OUI | Hérité de Slice 02 |
| Table `reviews` accessible | DB | OUI | Requête `SELECT rating FROM reviews WHERE reviewee_id = $1` |
| Table `users` (colonnes IBAN) | DB | OUI | `iban`, `bic`, `iban_name` — présents dans `users` mais absents de `USER_FIELDS` |

### Absence de dépendances (confirmé)

- Pas de Stripe
- Pas d'upload / R2
- Pas de workers
- Pas de WebSocket
- Pas de push notifications
- Pas de bcrypt (lecture seule)
- Pas d'écriture en DB

---

## Niveau de risque

**FAIBLE.**

- Logique applicative simple : lecture seule
- Réutilise l'infrastructure JWT de Slice 02 sans modification
- Deux requêtes DB supplémentaires (reviews + banking) simples
- Aucun effet de bord

Seul risque réel : **oublier les 5 champs supplémentaires** (`avg_rating`, `review_count`, `iban`, `bic`, `iban_name`) qui ne figurent PAS dans `USER_FIELDS` de Slice 02.

---

## Lien avec Slice 02 (`GET /api/auth/me`)

| Aspect | Slice 02 (`GET /api/auth/me`) | Slice 03 (`GET /api/users/profile`) |
|---|---|---|
| Auth | `require_auth()` identique | `require_auth()` identique |
| USER_FIELDS (18 colonnes) | Retournés directement | Retournés + 5 champs extra |
| Requêtes DB | 1 (SELECT sur `users`) | 3 (users × 2 + reviews × 1) |
| Champs supplémentaires | aucun | `avg_rating`, `review_count`, `iban`, `bic`, `iban_name` |
| Chemin | `/api/auth/me` | `/api/users/profile` → Java: `/api/users/me` |

**En Java**, il est possible de créer un `UserProfileDto` qui étend `AuthMeDto` en ajoutant les 5 champs.

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Nommage `/profile` vs `/me` | Le chemin Python est `/api/users/profile`. La migration est l'occasion de renommer en `/api/users/me`. Vérifier que le frontend est mis à jour si on change le chemin côté Java. |
| P2 | 5 champs extra hors `USER_FIELDS` | `avg_rating`, `review_count`, `iban`, `bic`, `iban_name` ne viennent PAS de la même requête que les 18 USER_FIELDS. Deux requêtes DB distinctes. Ne pas les oublier dans le DTO Java. |
| P3 | `avg_rating` peut être `null` | Si l'utilisateur n'a aucun avis, `avg_rating = null` (pas `0`). `review_count = 0` (pas null). Ne pas confondre les deux. |
| P4 | Deuxième requête sur `users` pour IBAN | Le handler re-requête `users` (lignes 17–18) pour `iban`, `bic`, `iban_name`. Ces colonnes ne sont pas dans `USER_FIELDS`. Ajouter une projection spécifique ou une requête dédiée. |
| P5 | IBAN/BIC potentiellement nuls | `banking["iban"]`, `banking["bic"]`, `banking["iban_name"]` sont ajoutés tels quels — peuvent être `null` en DB. Le DTO doit les accepter comme `String` nullable. |
