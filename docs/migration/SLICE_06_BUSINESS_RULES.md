# SLICE_06_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py:568–613`, `auth_utils.py:86–100`.
> Généré le 2026-02-XX.

---

## RG-01 — Auth optionnelle via `get_optional_auth`

**Source :** `user_routes.py:572–573` et `user_routes.py:596–597`

```python
me = await get_optional_auth(request, pool)
me_id = me["user_id"] if me else None
```

`get_optional_auth` (`auth_utils.py:86–100`) gère :
- Absence de token → retourne `None`
- Token invalide → retourne `None` (exception interne avalée)
- Token expiré → retourne `None`
- `user_id` absent de DB → retourne `None`

**Conséquence :** Les deux endpoints retournent HTTP 200 dans tous les cas, quel que soit le token.
Jamais de 401. Le seul effet du token : enrichir `is_following_back` / `follows_back` / `is_blocked`.

**Différence avec Slice 04 :** Slice 04 utilisait un try/except inline. Ici, c'est une fonction
dédiée avec le même résultat. Java peut réutiliser le même mécanisme d'auth optionnelle.

---

## RG-02 — Champs contextuels à `false` si non authentifié

**Source :** `user_routes.py:577–582` (CASE WHEN $1::TEXT IS NOT NULL)

```sql
CASE WHEN $1::TEXT IS NOT NULL THEN
    EXISTS(...)
ELSE FALSE END AS is_following_back
```

Si `me_id = NULL` :
- `is_following_back = false`
- `follows_back = false`
- `is_blocked = false`

Ces champs sont toujours présents dans la réponse (jamais absents), mais valent `false` si non auth.

---

## RG-03 — Pas de 404 si user_id inexistant

**Source :** Absence de vérification d'existence dans le handler

Il n'y a pas de `SELECT user_id FROM users WHERE user_id=$1` avant la requête principale.
Si le `user_id` n'existe pas → la JOIN retourne 0 rows → réponse `[]` → HTTP 200.

**Ne PAS ajouter de 404** — reproduire le comportement Python.

---

## RG-04 — Pas de pagination

**Source :** Aucun `LIMIT` / `OFFSET` dans les requêtes SQL

Toute la liste est retournée d'un seul appel. Pas de paramètres `skip`, `limit`, `page`.

**Ne PAS ajouter de pagination** — reproduire le comportement Python v1.
*(Une future optimisation pourrait être documentée séparément, hors scope de cette slice.)*

---

## RG-05 — Tri alphabétique obligatoire

**Source :** `ORDER BY u.name ASC` dans les deux requêtes

Les résultats sont toujours triés par `u.name ASC` (nom de l'utilisateur listé, ordre croissant).
Le tri est imposé par la DB, pas applicativement.

**En Java :** S'assurer que le query native `ORDER BY u.name ASC` est présent.
Ne pas trier applicativement (risque d'incohérence de collation).

---

## RG-06 — Différence sémantique des champs mutuels

Le nom du champ et sa sémantique diffèrent entre les deux endpoints :

| Endpoint | Champ | Signification |
|---|---|---|
| `GET /followers` | `is_following_back` | "Est-ce que l'appelant suit CE follower ?" |
| `GET /following` | `follows_back` | "Est-ce que CE following suit l'appelant ?" |

Ces deux noms doivent être reproduits exactement — le frontend les distingue.

---

## RG-07 — `is_blocked` : blocage par l'appelant uniquement

**Source :** `WHERE blocker_id=$1 AND blocked_id=u.user_id`

`is_blocked = true` signifie : "l'appelant a bloqué cet utilisateur".
Ce n'est **pas** le blocage réciproque. Si la cible a bloqué l'appelant, cela n'est pas reflété ici.

**Note :** Les utilisateurs bloqués apparaissent toujours dans la liste — ils ne sont pas filtrés.
`is_blocked` est une information de contexte, pas un filtre.

---

## RG-08 — Cohérence avec Slice 04 et 05

| Opération | Impact sur Slice 06 |
|---|---|
| `POST /follow` (Slice 05) | Nouvelle ligne dans `user_follows` → apparaît dans `/followers` de la cible et `/following` du caller |
| `DELETE /follow` (Slice 05) | Ligne supprimée → disparaît des deux listes |
| `GET /public` (Slice 04) | `followers_count` = COUNT(`/followers`), `following_count` = COUNT(`/following`) |

---

## Niveau de confiance

| Règle | Confiance | Source |
|---|---|---|
| RG-01 Auth optionnelle | HAUTE | `get_optional_auth` lu ligne par ligne |
| RG-02 Champs false si non auth | HAUTE | SQL CASE WHEN explicite |
| RG-03 Pas de 404 | HAUTE | Aucune vérification d'existence dans le code |
| RG-04 Pas de pagination | HAUTE | Aucun LIMIT/OFFSET dans les requêtes |
| RG-05 Tri ASC | HAUTE | ORDER BY u.name ASC explicite dans les deux requêtes |
| RG-06 Noms de champs différents | HAUTE | SQL aliasés différemment (`is_following_back` vs `follows_back`) |
| RG-07 is_blocked = caller only | HAUTE | `blocker_id=$1` — seul le caller est vérifiable |
