# SLICE_07_BUSINESS_RULES.md — Règles métier
> Basé sur `user_routes.py:632–664`.
> Généré le 2026-02-XX.

---

## RG-01 — Auth stricte (les deux endpoints)

**Source :** `user_routes.py:636` (block), `user_routes.py:658` (unblock)

`require_auth` sans try/except. Token absent, invalide ou expiré → **401**.
Identique à Slice 05 (follow/unfollow). Pas d'auth optionnelle.

---

## RG-02 — Self-block interdit (block uniquement)

**Source :** `user_routes.py:638–639`

```python
if blocker_id == user_id:
    raise HTTPException(400, "Vous ne pouvez pas vous bloquer vous-même.")
```

- Message exact : `"Vous ne pouvez pas vous bloquer vous-même."`
- Vérification **applicative** — pas de contrainte DB CHECK
- Cette vérification est **absente** dans unblock (mais sans impact pratique)

---

## RG-03 — Pas de vérification d'existence de la cible (les deux endpoints)

**Source :** Absence de vérification dans les deux handlers

Ni `SELECT user_id FROM users WHERE user_id=$1` ni aucune autre vérification.
- Block sur user inexistant → INSERT dans `user_blocks` quand même (FK `blocked_id → users.user_id` — si la FK est active, cela produit une erreur 500 côté DB)
- Unblock sur user inexistant → DELETE 0 rows → HTTP 200 silencieux

**INCERTITUDE :** La FK `user_blocks_blocked_id_fkey REFERENCES users(user_id)` pourrait rejeter un INSERT si `blocked_id` n'existe pas en DB — ce qui produirait une erreur 500 non gérée. Le Python ne gère pas ce cas explicitement. En Java, reproduire le même comportement (pas de vérification préalable).

---

## RG-04 — Block : effet secondaire sur user_follows (bidirectionnel)

**Source :** `user_routes.py:641–645`

```python
await conn.execute(
    "DELETE FROM user_follows WHERE (follower_id=$1 AND following_id=$2) OR (follower_id=$2 AND following_id=$1)",
    blocker_id, user_id
)
```

**Règle critique :** Bloquer supprime les liens de suivi dans **les deux sens** :
- Le bloqueur ne suit plus la cible
- La cible ne suit plus le bloqueur

Ce DELETE est exécuté **avant** l'INSERT du blocage.

**Impact sur les counts (cohérence avec Slices 04/05/06) :**
- `followers_count` et `following_count` des deux utilisateurs peuvent diminuer
- Les listes `/followers` et `/following` (Slice 06) sont mises à jour instantanément
- `is_following = true` dans Slice 04 devient `false` pour les deux côtés

---

## RG-05 — Unblock : ne restaure PAS les follows

**Source :** `user_routes.py:654–664` — absence totale de INSERT dans `user_follows`

Après un unblock, les liens de suivi **ne sont pas restaurés automatiquement**.
L'utilisateur débloqué doit re-suivre manuellement via Slice 05 si souhaité.

---

## RG-06 — Double block idempotent

**Source :** `user_routes.py:647–650`

`INSERT ... ON CONFLICT DO NOTHING` — double block → pas d'erreur.
Le DELETE `user_follows` est re-exécuté mais sans effet (0 rows supprimés car déjà nettoyé).

---

## RG-07 — Unblock silencieux si inexistant

**Source :** `user_routes.py:654–664`

DELETE 0 rows → HTTP 200, `{"blocked": false}`.
Pas de 404 même si le blocage n'existait pas.

---

## RG-08 — Impact sur Slice 06 (is_blocked dans les listes)

Dans les listes `/followers` et `/following` (Slice 06), le champ `is_blocked` est calculé
depuis `user_blocks`. Après un block, `is_blocked = true` pour la cible dans les listes.
Après un unblock, `is_blocked = false`.

**Mais :** après un block, la cible n'apparaît plus dans les listes followers/following
(car les follows ont été supprimés par R1). Le champ `is_blocked` n'est donc visible
que si l'utilisateur bloqué apparaît dans une autre liste (ex: suggestions futures).

---

## Différences block vs follow/unfollow (Slice 05)

| Aspect | POST /follow | POST /block |
|---|---|---|
| Self-check | OUI (400) | OUI (400, message différent) |
| Existence cible | OUI (404) | **NON** |
| Table principale | `user_follows` | `user_blocks` |
| Effet secondaire | Aucun | Supprime `user_follows` bidirectionnel |
| Idempotent | OUI | OUI |

| Aspect | DELETE /follow | DELETE /block |
|---|---|---|
| Self-check | NON | NON |
| Existence cible | NON | NON |
| Opération | DELETE `user_follows` | DELETE `user_blocks` |
| Effet secondaire | Aucun | Aucun |
| Idempotent | OUI | OUI |

---

## Niveau de confiance

| Règle | Confiance | Source |
|---|---|---|
| RG-01 Auth stricte | HAUTE | `require_auth` sans try/except — lignes 636, 658 |
| RG-02 Self-block 400 | HAUTE | Code explicite ligne 638–639 |
| RG-03 Pas de 404 | HAUTE | Aucune vérification dans les deux handlers |
| RG-04 DELETE follows bidirectionnel | HAUTE | SQL explicite avec OR — ligne 643 |
| RG-05 Unblock ne restaure pas | HAUTE | Absence totale d'INSERT dans unblock |
| RG-06 Double block idempotent | HAUTE | `ON CONFLICT DO NOTHING` — ligne 648 |
| RG-07 Unblock silencieux | HAUTE | DELETE sans vérification — ligne 661 |
| RG-03 FK contrainte DB | INCERTAIN | Si user_id inexistant : erreur 500 possible (FK) |
