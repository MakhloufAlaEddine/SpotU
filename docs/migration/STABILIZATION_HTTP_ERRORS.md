# STABILIZATION_HTTP_ERRORS.md — Analyse de l'écart 500 vs 503
> Basé sur `KNOWN_GAPS_VS_PYTHON.md`, `server.py` Python.
> Généré le 2026-02-XX.

---

## Constat de l'écart

### Comportement Python (FastAPI)

FastAPI ne dispose d'aucun handler global d'exception DB dans le code Python (`server.py`, `routes/*.py`). Lorsqu'une exception non gérée remonte (ex: `asyncpg.exceptions.PostgresConnectionError`, erreur réseau DB), FastAPI retourne :

```http
HTTP/1.1 500 Internal Server Error
{"detail": "Internal Server Error"}
```

C'est le comportement par défaut de Starlette/FastAPI : toute exception non catchée → **500**.

### Comportement Java actuel

Le `GlobalExceptionHandler` Java capture `DataAccessException` (Spring JDBC) et retourne :

```http
HTTP/1.1 503 Service Unavailable
{
  "error": "service_unavailable",
  "message": "Erreur d'accès à la base de données",
  "timestamp": "2026-02-XX T00:00:00Z"
}
```

**C'est une décision délibérée documentée dans `KNOWN_GAPS_VS_PYTHON.md`** : "écart volontaire (meilleure sémantique « service indisponible »)".

---

## Endpoints concernés

Tous les endpoints des slices 01–10 sont concernés car tous font des accès DB :

| Endpoint | Slice | Type d'accès DB |
|---|---|---|
| `GET /api/config/booking` | 01 | `app_config` |
| `GET /api/config/commission` | 01 | `pricing_rules` |
| `GET /api/auth/me` | 02 | `users` |
| `GET /api/users/me` | 03 | `users`, `reviews` |
| `GET /api/users/{id}/public` | 04 | 8 tables |
| `POST/DELETE /api/users/{id}/follow` | 05 | `user_follows` |
| `GET /api/users/{id}/followers\|following` | 06 | `user_follows`, `users` |
| `POST/DELETE /api/users/{id}/block` | 07 | `user_blocks`, `user_follows` |
| `GET /api/users/{id}/reviews` | 08 | `reviews`, `users` |
| `GET /api/services` | 09 | `services` + 6 tables |
| `GET /api/services/{id}` | 09 | `services` + 8 tables |
| `GET /api/domains` | 10 | `domains` |
| `GET /api/tags/categories` | 10 | `tag_categories`, `tags` |
| `GET /api/tags` | 10 | `tags` |

---

## Impact frontend

### Scénario 1 — Frontend gère les codes par switch/if

Si le code React Native fait :
```typescript
if (error.status === 500) {
  showToast("Erreur inattendue");
} else if (error.status === 503) {
  showToast("Service temporairement indisponible");
}
```
→ **Impact visible** : messages d'erreur différents selon le backend appelé.

### Scénario 2 — Frontend traite toute erreur >= 500 de la même façon

```typescript
if (error.status >= 500) {
  showToast("Erreur serveur");
}
```
→ **Aucun impact** : 503 et 500 déclenchent le même code.

### Scénario 3 — Appels API avec retry automatique sur 503

Certaines librairies HTTP (Axios interceptors, React Query `retry`) distinguent 503 "retry" de 500 "fatal error". En retournant 503, le Java peut déclencher des retry automatiques non prévus.

→ **Impact potentiel** si retry côté client configuré sur 503.

---

## Analyse comparée

| Critère | 500 (comportement Python) | 503 (comportement Java actuel) |
|---|---|---|
| Sémantique RFC 9110 | "Erreur interne" — cause inconnue | "Service temporairement indisponible" — DB down |
| Précision sémantique | Moins précis | **Plus précis** — DB inaccessible = service indisponible |
| Cohérence avec Python | Identique | **Diverge** |
| Retry côté client | Ne déclenche pas de retry automatique en général | Peut déclencher des retry selon la config client |
| Corps de la réponse | `{"detail": "Internal Server Error"}` | `{"error": "service_unavailable", "message": "..."}` |
| Format JSON | Identique (`detail` vs `error`+`message`) | **Diverge** — structure différente |

---

## Recommandation

### Option A — Conserver 503 (recommandée)

**Justification :**
- La décision est délibérée et documentée
- 503 est sémantiquement plus correct pour une panne DB
- La seule vraie divergence est le corps JSON (`detail` vs `error`+`message`)
- **Action uniquement si nécessaire :** aligner le corps JSON sur le format Python (`{"detail": "..."}`) dans le `GlobalExceptionHandler`

```java
// GlobalExceptionHandler.java — option A (corps aligné)
@ExceptionHandler(DataAccessException.class)
public ResponseEntity<Map<String, Object>> handleDataAccess(DataAccessException ex) {
    return ResponseEntity.status(503)
        .body(Map.of("detail", "Service temporairement indisponible"));
    // "detail" au lieu de "error"+"message" — aligne le format sur Python
}
```

### Option B — Aligner sur 500

```java
@ExceptionHandler(DataAccessException.class)
public ResponseEntity<Map<String, Object>> handleDataAccess(DataAccessException ex) {
    return ResponseEntity.status(500)
        .body(Map.of("detail", "Internal Server Error"));
}
```

**Inconvénient :** perd la précision sémantique du 503. Ne résout pas le problème de fond.

---

## Décision recommandée

**Conserver 503 (Option A) + aligner uniquement le format du corps JSON sur `{"detail": "..."}` si le frontend utilise le champ `detail`.**

Ce choix :
- Préserve la meilleure sémantique
- Aligne le format JSON sur Python (seul écart visible par le frontend)
- Ne nécessite pas de décision architecturale majeure
- Est documenté → ne surprendra pas les développeurs Java futurs

**Effort : FAIBLE** — une ligne dans `GlobalExceptionHandler.java`.

---

## Decision humaine requise

**Vérifier dans le code React Native :**
1. Le frontend gère-t-il explicitement HTTP 503 différemment de 500 ?
2. Le frontend lit-il le champ `detail` ou `error`/`message` dans la réponse d'erreur ?

Ces deux points déterminent si l'alignement du corps JSON est nécessaire ou optionnel.
