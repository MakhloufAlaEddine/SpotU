# SLICE_07_SCOPE.md — Cadrage de la Slice 07
> Basé sur `user_routes.py:632–664`, `migrations/001_initial_schema.sql:516–527`.
> Généré le 2026-02-XX.

---

## Endpoints inclus dans cette slice

| # | Méthode | Chemin Python (prod) | Chemin Java (cible) | Fichier Python | Lignes |
|---|---|---|---|---|---|
| 1 | POST | `/api/users/{user_id}/block` | `/api/users/{userId}/block` | `user_routes.py` | 632–651 |
| 2 | DELETE | `/api/users/{user_id}/block` | `/api/users/{userId}/block` | `user_routes.py` | 654–664 |

---

## Endpoints explicitement exclus

| Endpoint | Raison d'exclusion |
|---|---|
| `DELETE /api/users/{user_id}/followers/{follower_id}` | Retrait d'un follower — endpoint distinct, Slice 6b+ |
| `GET /api/users/{user_id}/suggestions` | Algo suggestions (exclut bloqués) — Slice 8+ |
| `GET /api/users/{user_id}/blocked` | Liste des utilisateurs bloqués — non présent dans les slices actuelles |

---

## Auth

**Les deux endpoints utilisent `require_auth` (strict)** — identique à Slice 05.
Token absent, invalide ou expiré → **401**. Pas d'auth optionnelle ici.

---

## Dépendances exactes

| Dépendance | Type | Obligatoire | Détail |
|---|---|---|---|
| `JwtAuthFilter` + `require_auth` | Auth | OUI | Hérité Slice 02 — strict |
| Table `user_blocks` | DB | OUI | INSERT (block) + DELETE (unblock) |
| Table `user_follows` | DB | OUI | DELETE bidirectionnel lors du block uniquement |

---

## Niveau de risque

**FAIBLE à MOYEN.**

- Faible : opérations simples sur 1–2 tables, pas de jointure, pas de JSONB
- Moyen : le **block déclenche un effet secondaire** sur `user_follows` — suppression bidirectionnelle des liens de suivi. C'est la première mutation qui impacte deux tables dans la même opération.
- Pas de transaction explicite dans le Python (deux `conn.execute` séquentiels sans `BEGIN`/`COMMIT`)

---

## Lien avec les slices précédentes

| Slice | Impact |
|---|---|
| Slice 05 (follow/unfollow) | Le block supprime les follows dans les deux sens |
| Slice 06 (followers/following lists) | Après un block, le bloqué disparaît des listes `followers` et `following` des deux utilisateurs |
| Slice 04 (profil public) | `followers_count` et `following_count` diminuent après un block si une relation de suivi existait |

---

## Pièges

| # | Piège | Détail |
|---|---|---|
| P1 | Effet secondaire sur `user_follows` (block seulement) | Le block supprime les follows **dans les deux sens** via un DELETE avec OR. L'unblock ne restaure PAS ces follows. |
| P2 | Pas de vérification d'existence de la cible | Ni block ni unblock ne vérifient que `user_id` existe. Block peut insérer un blocage vers un user fantôme. Unblock est silencieux si la cible n'existe pas. |
| P3 | Double block idempotent | `ON CONFLICT DO NOTHING` sur la PK `(blocker_id, blocked_id)`. Ne PAS retourner 409. |
| P4 | Unblock silencieux | DELETE 0 rows → HTTP 200, `{"blocked": false}`. Pas de 404 si la relation de blocage n'existe pas. |
| P5 | Deux tables, pas de transaction | Le Python exécute le DELETE `user_follows` puis le INSERT `user_blocks` sans `BEGIN/COMMIT` explicite. En cas de coupure entre les deux, `user_follows` peut être nettoyé sans que le blocage soit inscrit. En Java, envisager `@Transactional` pour atomicité (comportement légèrement meilleur que Python, acceptable). |
