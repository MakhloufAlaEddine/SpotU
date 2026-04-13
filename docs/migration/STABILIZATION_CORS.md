# STABILIZATION_CORS.md — Analyse et correction de la configuration CORS
> Basé sur `server.py:246–271` (Python), `KNOWN_GAPS_VS_PYTHON.md — Sécurité`.
> Généré le 2026-02-XX.

---

## Configuration Python actuelle (référence — CONSTAT CERTAIN)

```python
# server.py:246–271
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _raw_origins:
    _allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
else:
    _app_url = os.environ.get("APP_URL", "").strip()
    _allowed_origins = [_app_url] if _app_url else []
    logger.warning("CORS: ALLOWED_ORIGINS absent du .env — utilisation de APP_URL=%r en fallback.")

if not _allowed_origins:
    logger.error("CORS: aucune origine autorisée configurée — toutes les requêtes CORS seront bloquées.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,      # ← liste explicite CSV
    allow_credentials=True,              # ← cookies + Authorization header
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```

**Propriétés clés :**
- `allow_origins` = liste **explicite** depuis variable d'environnement `ALLOWED_ORIGINS` (format CSV)
- `allow_credentials=True` → en-têtes `Authorization` et cookies autorisés
- Méthodes : liste **fermée** (pas de `*`)
- Headers : liste **fermée** (`Authorization`, `Content-Type`)
- Le code contient un commentaire explicite : **"Ne JAMAIS utiliser `[\"*\"]` avec `allow_credentials=True`"**

---

## Configuration Java actuelle (à corriger)

D'après `KNOWN_GAPS_VS_PYTHON.md` :
```java
// Problème constaté
allowedOriginPatterns("*")   // ← wildcard sur toutes les origines
```

---

## Risques du wildcard `*`

### Risque 1 — Violation de la spec CORS (critique)

La spec CORS ([RFC 6454](https://www.rfc-editor.org/rfc/rfc6454), section Access-Control) **interdit** la combinaison `Access-Control-Allow-Origin: *` avec `Access-Control-Allow-Credentials: true`.

Les navigateurs modernes (Chrome, Firefox, Safari) **bloquent** cette combinaison et retournent une erreur CORS côté client :
```
Access to XMLHttpRequest at 'https://api.spotu.app' from origin 'https://app.spotu.app'
has been blocked by CORS policy:
The value of the 'Access-Control-Allow-Credentials' header in the response is '' which
must be 'true' when the request's credentials mode is 'include'.
```

→ **Toutes les requêtes authentifiées (POST, auth, bookings) seront bloquées en production.**

### Risque 2 — Exposition large en pre-prod

Même en pre-prod, `allowedOriginPatterns("*")` autorise n'importe quel domaine externe à appeler l'API Java avec des credentials → risque de fuite de données entre environnements.

### Risque 3 — `allowedOriginPatterns` vs `allowedOrigins`

Spring Boot distingue :
- `allowedOrigins("*")` : wildcard standard → interdit avec credentials
- `allowedOriginPatterns("*")` : contournement Spring Boot → retourne l'origine exacte de la requête en miroir → **autorise effectivement toutes les origines**

`allowedOriginPatterns("*")` contourne la restriction navigateur mais crée un risque de sécurité équivalent.

---

## Configuration Java recommandée (production)

### Reproduire exactement le comportement Python

```java
// CorsConfig.java (Spring Boot)
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value("${app.cors.allowed-origins:}")
    private String allowedOriginsRaw;  // Variable d'env : APP_CORS_ALLOWED_ORIGINS

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        List<String> origins = parseOrigins(allowedOriginsRaw);

        if (origins.isEmpty()) {
            // Même comportement que Python : bloquer tout si non configuré
            throw new IllegalStateException(
                "CORS: APP_CORS_ALLOWED_ORIGINS non défini. " +
                "Configurer cette variable avant le démarrage."
            );
        }

        registry.addMapping("/api/**")
            .allowedOrigins(origins.toArray(new String[0]))  // ← liste explicite
            .allowCredentials(true)                           // ← credentials autorisés
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowedHeaders("Authorization", "Content-Type")
            .maxAge(3600);
    }

    private List<String> parseOrigins(String raw) {
        if (raw == null || raw.isBlank()) return Collections.emptyList();
        return Arrays.stream(raw.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .toList();
    }
}
```

**Variable d'environnement à configurer :**
```bash
# application.properties ou .env
APP_CORS_ALLOWED_ORIGINS=https://app.spotu.app,https://admin.spotu.app

# Dev local
APP_CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:19006,exp://localhost:8081
```

---

## Correspondance Python → Java

| Propriété Python | Valeur Python | Java équivalent |
|---|---|---|
| `allow_origins` | `ALLOWED_ORIGINS` (CSV env var) | `allowedOrigins(origins[])` depuis `APP_CORS_ALLOWED_ORIGINS` |
| `allow_credentials` | `True` | `.allowCredentials(true)` |
| `allow_methods` | GET, POST, PUT, PATCH, DELETE, OPTIONS | `.allowedMethods(...)` |
| `allow_headers` | Authorization, Content-Type | `.allowedHeaders(...)` |
| Comportement si non configuré | Log error, toutes requêtes bloquées | Exception au démarrage (plus strict) |

---

## Config recommandée par environnement

| Env | Valeur `APP_CORS_ALLOWED_ORIGINS` |
|---|---|
| Production | `https://app.spotu.app` (liste stricte) |
| Staging | `https://staging.spotu.app` |
| Dev local | `http://localhost:3000,http://localhost:19006,exp://localhost:8081` |
| Tests (unit/integration) | Non requis (les tests ne passent pas par CORS) |

---

## Effort de correction

**FAIBLE** — modification d'un seul fichier de configuration Java + ajout d'une variable d'environnement.

Durée estimée : **30 minutes à 1 heure**.

---

## Vérification post-correction

```bash
# Tester depuis un navigateur ou curl avec Origin header
curl -I -H "Origin: https://app.spotu.app" \
     -H "Authorization: Bearer TOKEN" \
     https://api-java.spotu.app/api/domains

# Vérifier la présence de :
# Access-Control-Allow-Origin: https://app.spotu.app  (pas *)
# Access-Control-Allow-Credentials: true
```
