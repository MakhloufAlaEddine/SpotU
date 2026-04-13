# SLICE_08_SCOPE.md — Cadrage de la Slice 08
> Basé sur `user_routes.py:238–259`, `migrations/001_initial_schema.sql:263–276`, `database.py:53–69`.
> Généré le 2026-02-XX.

---

## Identification de l'endpoint

Un seul endpoint de lecture reviews simple et propre existe dans le codebase :

| # | Méthode | Chemin Python | Chemin Java (cible) | Fichier | Lignes |
|---|---|---|---|---|---|
| 1 | GET | `/api/users/{user_id}/reviews` | `/api/users/{userId}/reviews` | `user_routes.py` | 238–259 |

---

## Endpoints de lecture review exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `POST /api/users/{user_id}/reviews` | Écriture — auth requise, push notification, duplicate check — Slice 9 |
| `PUT /api/users/{user_id}/reviews/{review_id}` | Écriture — auth, push notification — Slice 9 |
| Lectures reviews dans booking_routes.py | Reviews liées à des bookings — Slice 11+ |

---

## Auth

**Aucune auth** — ni `require_auth`, ni `get_optional_auth`, ni aucun token lu.

C'est l'endpoint le plus public du codebase Python après Slice 01 (config).
N'importe qui peut lire les reviews sans être connecté.

**Mais** : le privacy flag `show_reviews` de l'utilisateur peut forcer un retour `[]`.

---

## Dépendances exactes

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| Table `reviews` | DB | OUI | Source principale — 6 colonnes |
| Table `users` | DB | OUI | JOIN pour `reviewer_id`, `reviewer_name`, `reviewer_picture` |
| `show_reviews` dans `users` | DB | OUI | Privacy gate — SELECT préalable |

---

## Niveau de risque

**TRÈS FAIBLE.**

- Lecture seule, pas d'auth, un seul JOIN simple
- Seul comportement non-trivial : la privacy gate `show_reviews` qui retourne `[]` (pas 403)
- Cohérence à maintenir avec `avg_rating` / `review_count` de Slices 03 et 04

---

## Lien avec les slices précédentes

| Slice | Lien |
|---|---|
| Slice 03 (`/api/users/me`) | `avg_rating` et `review_count` calculés depuis la même table `reviews` |
| Slice 04 (profil public) | `avg_rating` / `review_count` conditionnels sur `show_reviews` |
| Slice 08 (ce slice) | Expose la **liste détaillée** des reviews — même privacy gate `show_reviews` |

**Cohérence attendue :**
Si `avg_rating = null` et `review_count = 0` dans Slice 04 (cause : `show_reviews=false`),
alors `GET /api/users/{id}/reviews` retourne `[]` pour le même `user_id`.

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | `show_reviews=false` → `[]` pas 403 | Python retourne `return []` (HTTP 200, pas 403 "Forbidden"). Ne pas ajouter de 403. |
| P2 | 404 si user inexistant, mais pas si reviews vides | User existant + 0 reviews → `[]`. User inexistant → 404. Deux SELECT distincts (un pour existence/privacy, un pour les reviews). |
| P3 | `created_at` via `rows_to_list` → ISO 8601 avec timezone | `database.py:61–62` : `.isoformat()` sur TIMESTAMPTZ. Format attendu : `"2026-04-01T12:51:14.682000+00:00"`. Ne pas retourner un format sans timezone. |
| P4 | `booking_id` non exposé mais présent en DB | La colonne `booking_id` existe dans `reviews` mais n'est pas dans le SELECT. Ne pas l'ajouter — comportement Python intentionnel. |
| P5 | Aucune pagination — tout retourné | Un profil très populaire peut avoir des centaines de reviews. Reproduire sans `LIMIT`. |
