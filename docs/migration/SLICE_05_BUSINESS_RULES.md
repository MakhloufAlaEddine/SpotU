# SLICE_05_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py:494–522`, `migrations/001_initial_schema.sql`.
> Généré le 2026-02-XX.

---

## RG-01 — Authentification obligatoire (les deux endpoints)

**Source :** `user_routes.py:497` (follow) et `user_routes.py:515` (unfollow)

Les deux endpoints appellent `require_auth(request, pool)` **sans try/except**.
Un token absent, invalide ou expiré retourne 401 (comportement strict — différent de Slice 04).

---

## RG-02 — Interdiction du self-follow (follow uniquement)

**Source :** `user_routes.py:498–499`

```python
if me["user_id"] == user_id:
    raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous suivre vous-même.")
```

- Si l'appelant tente de se suivre lui-même → **HTTP 400**
- Message exact : `"Vous ne pouvez pas vous suivre vous-même."`
- Note : la vérification est **applicative** — il n'y a pas de contrainte DB CHECK pour cela
- Note : cette vérification n'existe PAS dans `unfollow` (mais n'a pas d'impact pratique)

**En Java :** Vérifier `principal.getUserId().equals(userId)` AVANT la requête DB.

---

## RG-03 — Vérification d'existence de la cible (follow uniquement)

**Source :** `user_routes.py:501–503`

```python
target = await conn.fetchval("SELECT user_id FROM users WHERE user_id=$1", user_id)
if not target:
    raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
```

- Si la cible n'existe pas en DB → **HTTP 404**
- Message exact : `"Utilisateur introuvable."`
- Cette vérification est **absente dans unfollow** (voir RG-04)

---

## RG-04 — Unfollow silencieux si relation inexistante ou user inexistant

**Source :** `user_routes.py:512–522`

`unfollow_user` n'effectue aucune vérification :
- Pas de vérification d'existence de la cible
- Pas de vérification que la relation de follow existe

**Conséquences :**
- `DELETE 0 rows` → HTTP 200, `{"is_following": false, "followers_count": 0}`
- Unfollow d'un user supprimé → HTTP 200, `followers_count = 0`

**Ne PAS ajouter de 404 à unfollow** — reproduire le comportement Python exact.

---

## RG-05 — Follow idempotent (double follow)

**Source :** `user_routes.py:504–506`

```sql
INSERT INTO user_follows(follower_id, following_id) VALUES($1, $2) ON CONFLICT DO NOTHING
```

- Deuxième appel à `POST /follow` sur la même paire → pas d'erreur, pas de doublon
- La PK composite `(follower_id, following_id)` absorbe le conflit
- `followers_count` retourné est le vrai total courant (pas de doublon)

---

## RG-06 — followers_count recalculé depuis DB après chaque mutation

**Source :** `user_routes.py:508` et `user_routes.py:521`

```python
followers = await conn.fetchval(
    "SELECT COUNT(*) FROM user_follows WHERE following_id=$1", user_id
)
return {"is_following": True/False, "followers_count": int(followers)}
```

Le `followers_count` est **toujours recalculé depuis la DB** après l'opération.
Il n'est pas calculé applicativement (pas de `count + 1` ou `count - 1`).

Raison : sous forte concurrence, d'autres follows/unfollows peuvent avoir eu lieu entre
la mutation et le SELECT COUNT. Le Python retourne donc la valeur la plus fraîche possible.

**En Java :** Ne pas calculer applicativement. Toujours exécuter le SELECT COUNT après la mutation.

---

## RG-07 — Pas de notification ni effet secondaire

**Source :** code complet vérifié (`user_routes.py:494–522`)

L'action follow/unfollow ne déclenche :
- Pas de push notification
- Pas de WebSocket event
- Pas de mise à jour de score/ranking
- Pas de log d'activité

La seule écriture est la table `user_follows`.

---

## RG-08 — Cohérence avec le champ `is_following` (Slice 04)

Le champ `is_following` exposé dans `GET /api/users/{user_id}/public` (Slice 04) reflète
l'état de la table `user_follows` au moment de la lecture.

Après un `POST /follow` → le prochain appel à `GET /api/users/{user_id}/public` (même token)
doit retourner `is_following=true`.

**Pas de cache côté Java à invalider** — le Python ne cache rien, chaque requête relit la DB.

---

## Différences critiques entre follow et unfollow

| Règle | POST /follow | DELETE /follow |
|---|---|---|
| Auth | OUI (strict) | OUI (strict) |
| Self-check | **OUI → 400** | **NON** |
| Vérif existence cible | **OUI → 404** | **NON** |
| Comportement si rel. existante | Silencieux (idempotent) | N/A |
| Comportement si rel. inexistante | N/A | Silencieux (idempotent) |
| Erreurs possibles | 400, 401, 404 | **401 uniquement** |

---

## Niveau de confiance

| Règle | Confiance | Source |
|---|---|---|
| RG-01 Auth stricte | HAUTE | `require_auth` sans try/except — lignes 497, 515 |
| RG-02 Self-follow 400 | HAUTE | Code explicite lignes 498–499 |
| RG-03 Vérif existence 404 | HAUTE | Code explicite lignes 501–503 |
| RG-04 Unfollow silencieux | HAUTE | Absence totale de vérification dans unfollow |
| RG-05 Double follow idempotent | HAUTE | `ON CONFLICT DO NOTHING` — SQL vérifiée |
| RG-06 COUNT recalculé | HAUTE | Code explicite lignes 508, 521 |
| RG-07 Aucun effet secondaire | HAUTE | Lecture complète du handler vérifiée |
