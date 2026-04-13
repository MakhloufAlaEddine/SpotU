# SLICE_07_API_CONTRACTS.md — Contrat d'API exact
> Basé sur `user_routes.py:632–664`.
> Généré le 2026-02-XX.

---

## ENDPOINT 1 — POST /api/users/{user_id}/block

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `POST` |
| Chemin Python | `/api/users/{user_id}/block` |
| Chemin Java cible | `/api/users/{userId}/block` |
| Auth | **OBLIGATOIRE** — `require_auth` (strict) |
| Idempotent | **OUI** — double block = silencieux (`ON CONFLICT DO NOTHING`) |
| Effet | INSERT `user_blocks` + DELETE bidirectionnel `user_follows` |
| Handler | `block_user()` — `user_routes.py:632–651` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | ID de l'utilisateur à bloquer |

### Body / Query Params

**Aucun.** Requête sans corps.

### Réponse — HTTP 200

```json
{
  "blocked": true
}
```

| Champ | Type JSON | Type Java | Note |
|---|---|---|---|
| `blocked` | `boolean` | `boolean` | Toujours `true` pour ce endpoint |

### Codes d'erreur

| Code HTTP | Condition | Corps | Source Python |
|---|---|---|---|
| `400` | Self-block (`blocker_id == user_id`) | `{"detail": "Vous ne pouvez pas vous bloquer vous-même."}` | `user_routes.py:638–639` |
| `401` | Token absent / invalide / expiré | `{"detail": "Not authenticated"}` / etc. | `require_auth` |

**Note :** Pas de 404 si `user_id` cible n'existe pas. Le block est inséré quand même.

### Comportement idempotent

```sql
INSERT INTO user_blocks(blocker_id, blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING
```
Double block → pas d'erreur. Mais le DELETE `user_follows` est re-exécuté à chaque appel (0 rows si déjà supprimés — sans impact).

---

## ENDPOINT 2 — DELETE /api/users/{user_id}/block

### Métadonnées

| Attribut | Valeur |
|---|---|
| Méthode | `DELETE` |
| Chemin Python | `/api/users/{user_id}/block` |
| Chemin Java cible | `/api/users/{userId}/block` |
| Auth | **OBLIGATOIRE** — `require_auth` (strict) |
| Idempotent | **OUI** — unblock inexistant = silencieux (DELETE 0 rows) |
| Effet | DELETE `user_blocks` uniquement — **ne restaure pas les follows** |
| Handler | `unblock_user()` — `user_routes.py:654–664` |

### Path Parameters

| Paramètre | Type | Obligatoire | Note |
|---|---|---|---|
| `user_id` | `string` | OUI | ID de l'utilisateur à débloquer |

### Body / Query Params

**Aucun.**

### Réponse — HTTP 200

```json
{
  "blocked": false
}
```

| Champ | Type JSON | Type Java | Note |
|---|---|---|---|
| `blocked` | `boolean` | `boolean` | Toujours `false` pour ce endpoint |

### Codes d'erreur

| Code HTTP | Condition | Corps |
|---|---|---|
| `401` | Token absent / invalide / expiré | `{"detail": "Not authenticated"}` / etc. |

**Note :** Pas de 400 (pas de self-check), pas de 404 (DELETE silencieux si inexistant).

---

## Tableau comparatif block vs unblock

| Aspect | POST /block | DELETE /block |
|---|---|---|
| Auth | OUI (strict) | OUI (strict) |
| Self-check | **OUI → 400** | **NON** |
| Existence cible | **NON** | **NON** |
| Table `user_blocks` | INSERT ON CONFLICT | DELETE |
| Table `user_follows` | **DELETE bidirectionnel** | **Non touchée** |
| Idempotent | OUI | OUI |
| Réponse | `{"blocked": true}` | `{"blocked": false}` |
| Erreurs possibles | 400, 401 | 401 uniquement |
| Restaure les follows ? | N/A | **NON** |
