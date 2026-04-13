# SLICE_05_SCOPE.md — Cadrage de la Slice 05
> Basé sur `user_routes.py:494–522`, `migrations/001_initial_schema.sql:528–540`.
> Généré le 2026-02-XX.

---

## Endpoints inclus dans cette slice

| # | Méthode | Chemin Python (prod) | Chemin Java (cible) | Fichier Python | Ligne |
|---|---|---|---|---|---|
| 1 | POST | `/api/users/{user_id}/follow` | `/api/users/{userId}/follow` | `user_routes.py` | 494–509 |
| 2 | DELETE | `/api/users/{user_id}/follow` | `/api/users/{userId}/follow` | `user_routes.py` | 512–522 |

Les deux chemins Java sont identiques aux chemins Python — pas de renommage requis.

---

## Endpoints explicitement exclus de cette slice

| Endpoint | Raison d'exclusion |
|---|---|
| `GET /api/users/{user_id}/followers` | Lecture liste abonnés — Slice 6 |
| `GET /api/users/{user_id}/following` | Lecture liste abonnements — Slice 6 |
| `DELETE /api/users/{user_id}/followers/{follower_id}` | Suppression d'un follower (action owner) — Slice 6 |
| `GET /api/users/{user_id}/suggestions` | Suggestions d'utilisateurs — algorithme complexe, Slice 6+ |
| `POST/DELETE /api/users/{user_id}/block` | Blocage utilisateur — Slice 6+ |

---

## Dépendances exactes

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| `JwtAuthFilter` opérationnel | Auth | OUI | Hérité Slice 02 — `require_auth` obligatoire sur les deux endpoints |
| Table `users` | DB | OUI | Vérification existence de la cible (follow uniquement) |
| Table `user_follows` | DB | OUI | INSERT (follow) + DELETE (unfollow) + COUNT (les deux) |
| Contrainte PK `(follower_id, following_id)` | DB | OUI | `ON CONFLICT DO NOTHING` cible cette PK composite |

### Absence de dépendances (confirmé)
- Pas de Stripe
- Pas d'upload / R2
- Pas de workers
- Pas de WebSocket
- Pas de push notifications métier
- Pas de bcrypt
- Pas de jointures complexes

---

## Niveau de risque

**FAIBLE.**

- Deux opérations simples sur une seule table (`user_follows`)
- Aucune transaction explicite (chaque opération est atomique)
- Idempotence garantie côté DB (PK composite + ON CONFLICT)
- Réponse minimaliste (2 champs)

Risques résidus :
1. Asymétrie follow/unfollow sur la validation (à ne pas rater)
2. `followers_count` retourné après la mutation (COUNT post-write) — cohérence éventuelle sous forte concurrence (acceptable, même comportement Python)

---

## Lien avec Slice 04 (`GET /api/users/{user_id}/public`)

La Slice 04 expose `is_following` et `followers_count` / `following_count` en lecture.
La Slice 05 est le mécanisme d'écriture qui fait évoluer ces valeurs.

**Cohérence attendue :**
- Après `POST /follow` → `GET /users/{id}/public` doit retourner `is_following=true` et `followers_count` incrémenté
- Après `DELETE /follow` → `GET /users/{id}/public` doit retourner `is_following=false` et `followers_count` décrémenté

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Asymétrie follow vs unfollow | `follow` vérifie self-follow (400) ET existence cible (404). `unfollow` ne vérifie **ni l'un ni l'autre** — DELETE silencieux sur ligne inexistante. Ne pas ajouter ces vérifications à `unfollow`. |
| P2 | `ON CONFLICT DO NOTHING` — idempotence de follow | Double `POST /follow` → pas d'erreur, pas de doublon, retourne toujours `is_following=true`. La contrainte PK composite gère ça. En Java : `INSERT ... ON CONFLICT DO NOTHING` en JDBC natif, ou gérer via `IGNORE_DUPLICATE_KEY`. |
| P3 | `followers_count` lu APRÈS la mutation | Le COUNT est calculé après INSERT/DELETE dans la même connexion. Sous forte charge, ce nombre peut être légèrement décalé. **Ne pas retourner `followers_count ± 1`** calculé applicativement — toujours refaire le SELECT COUNT. |
| P4 | Unfollow sans vérification de l'existence | Si le `user_id` cible n'existe pas, `unfollow` retourne quand même HTTP 200 avec `followers_count = 0`. Ne pas ajouter de 404 ici — reproduire le comportement Python. |
