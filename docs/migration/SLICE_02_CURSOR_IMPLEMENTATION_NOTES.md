# SLICE_02_CURSOR_IMPLEMENTATION_NOTES.md — Consignes pour Cursor
> Basé sur `auth_utils.py` (complet) + réponse API live + schéma DB Supabase.  
> Généré le 2026-04-12.

---

## Objectif

Implémenter `GET /api/auth/me` en Java/Spring Boot en reproduisant fidèlement le comportement Python actuel :
1. Lire le token JWT depuis `Authorization: Bearer` ou cookie `winek_token`
2. Valider le token HS256 avec `JWT_SECRET`
3. Extraire `user_id` du payload JWT
4. Charger l'utilisateur depuis la DB (18 colonnes)
5. Retourner le JSON exact attendu

---

## Fichiers à créer

### 1. `CurrentUserDto.java` (DTO de réponse)

**Package** : `[votre.package].dto.auth`  
**Annotations Jackson** : `@JsonProperty` en snake_case ou config globale `SNAKE_CASE`

```java
public record CurrentUserDto(
    @JsonProperty("user_id")           String userId,
    @JsonProperty("email")             String email,
    @JsonProperty("name")              String name,
    @JsonProperty("role")              String role,
    @JsonProperty("language")          String language,
    @JsonProperty("picture")           String picture,
    @JsonProperty("bio")               String bio,
    @JsonProperty("phone")             String phone,
    @JsonProperty("is_coach_verified") Boolean isCoachVerified,
    @JsonProperty("coach_tags")        List<String> coachTags,
    @JsonProperty("show_phone")        boolean showPhone,
    @JsonProperty("show_reviews")      boolean showReviews,
    @JsonProperty("created_at")        String createdAt,
    @JsonProperty("updated_at")        String updatedAt,
    @JsonProperty("sports_level")      String sportsLevel,
    @JsonProperty("goals")             List<Object> goals,
    @JsonProperty("user_roles")        List<Object> userRoles,
    @JsonProperty("onboarding_done")   Boolean onboardingDone
) {}
```

**Choix des types** :
- `String` pour les timestamps (retourne la valeur ISO brute de la DB — évite les problèmes de format)
- `Boolean` (wrapper) pour les champs nullable (`is_coach_verified`, `onboarding_done`)
- `boolean` (primitif) pour `show_phone` et `show_reviews` (NOT NULL en DB)
- `List<String>` pour `coach_tags` (tableau de IDs string)
- `List<Object>` pour `goals` et `user_roles` (schéma JSONB non contraint)

---

### 2. `JwtService.java`

**Package** : `[votre.package].security`  
**Dépendance Maven** : `io.jsonwebtoken:jjwt-api:0.12.x` (ou `com.auth0:java-jwt:4.x`)

```java
@Service
public class JwtService {

    @Value("${app.jwt.secret}")          // valeur de JWT_SECRET env
    private String jwtSecret;

    /**
     * Valide et décode le token JWT.
     * Lève ResponseStatusException(401) si invalide / expiré / claim manquant.
     */
    public Map<String, Object> decodeToken(String token) {
        try {
            // Avec jjwt 0.12.x :
            Jws<Claims> claims = Jwts.parser()
                .verifyWith(Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8)))
                .build()
                .parseSignedClaims(token);

            Claims body = claims.getPayload();

            // Vérifier que user_id est présent
            String userId = body.get("user_id", String.class);
            if (userId == null) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token");
            }
            return Map.of(
                "user_id", userId,
                "role",    body.getOrDefault("role", "user")
            );
        } catch (ExpiredJwtException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token expired");
        } catch (UnsupportedJwtException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token algorithm");
        } catch (JwtException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token");
        }
    }
}
```

> **CRITIQUE** : `jwtSecret.getBytes(UTF_8)` — utiliser UTF-8, pas le charset par défaut de la JVM.

---

### 3. `JwtAuthFilter.java` (filtre Spring Security)

**Package** : `[votre.package].security`

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final UserRepository userRepository;

    // ...constructor...

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain)
            throws ServletException, IOException {

        String token = extractToken(request);

        if (token != null) {
            try {
                Map<String, Object> payload = jwtService.decodeToken(token);
                String userId = (String) payload.get("user_id");

                // Charger l'utilisateur depuis la DB
                CurrentUserDto user = userRepository.findByUserId(userId)
                    .orElse(null);

                if (user != null) {
                    // Stocker dans SecurityContext
                    UsernamePasswordAuthenticationToken auth =
                        new UsernamePasswordAuthenticationToken(user, null, Collections.emptyList());
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (ResponseStatusException e) {
                // Token invalide → ne pas bloquer ici (le controller lancera l'erreur si nécessaire)
                // Les endpoints publics passent quand même
            }
        }

        chain.doFilter(request, response);
    }

    /**
     * Lit le token depuis Authorization header (priorité 1) ou cookie winek_token (priorité 2).
     */
    private String extractToken(HttpServletRequest request) {
        String auth = request.getHeader("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) {
            return auth.substring(7);
        }
        if (request.getCookies() != null) {
            for (Cookie cookie : request.getCookies()) {
                if ("winek_token".equals(cookie.getName())) {
                    return cookie.getValue();
                }
            }
        }
        return null;
    }
}
```

> **Important** : `auth.startsWith("Bearer ")` — case-sensitive, espace compris. Ne PAS utiliser `equalsIgnoreCase`.

---

### 4. `UserRepository.java`

**Package** : `[votre.package].repository`  
**Technologie** : `JdbcTemplate`

```java
@Repository
public class UserRepository {

    private static final String USER_FIELDS = """
        user_id, email, name, role, language, picture, bio, phone,
        is_coach_verified, coach_tags::text, show_phone, show_reviews,
        created_at::text, updated_at::text,
        sports_level, goals::text, user_roles::text, onboarding_done
        """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    // ...constructor...

    public Optional<CurrentUserDto> findByUserId(String userId) {
        String sql = "SELECT " + USER_FIELDS + " FROM users WHERE user_id = ?";
        List<CurrentUserDto> results = jdbc.query(sql, (rs, rowNum) -> mapRow(rs), userId);
        return results.isEmpty() ? Optional.empty() : Optional.of(results.get(0));
    }

    private CurrentUserDto mapRow(ResultSet rs) throws SQLException {
        return new CurrentUserDto(
            rs.getString("user_id"),
            rs.getString("email"),
            rs.getString("name"),
            rs.getString("role"),
            rs.getString("language"),
            rs.getString("picture"),
            rs.getString("bio"),
            rs.getString("phone"),
            rsGetNullableBoolean(rs, "is_coach_verified"),
            parseJsonArray(rs.getString("coach_tags")),      // JSONB::text → List<String>
            rs.getBoolean("show_phone"),
            rs.getBoolean("show_reviews"),
            rs.getString("created_at"),                      // TEXT depuis ::text cast
            rs.getString("updated_at"),                      // TEXT depuis ::text cast
            rs.getString("sports_level"),
            parseJsonList(rs.getString("goals")),            // JSONB::text → List<Object>
            parseJsonList(rs.getString("user_roles")),       // JSONB::text → List<Object>
            rsGetNullableBoolean(rs, "onboarding_done")
        );
    }

    private Boolean rsGetNullableBoolean(ResultSet rs, String col) throws SQLException {
        boolean val = rs.getBoolean(col);
        return rs.wasNull() ? null : val;
    }

    @SuppressWarnings("unchecked")
    private List<String> parseJsonArray(String json) {
        if (json == null) return Collections.emptyList();
        try { return objectMapper.readValue(json, List.class); }
        catch (Exception e) { return Collections.emptyList(); }
    }

    @SuppressWarnings("unchecked")
    private List<Object> parseJsonList(String json) {
        if (json == null) return Collections.emptyList();
        try { return objectMapper.readValue(json, List.class); }
        catch (Exception e) { return Collections.emptyList(); }
    }
}
```

> **Note sur les timestamps** : utiliser `created_at::text` pour laisser PostgreSQL sérialiser en `"2026-04-01 12:51:14.682000+00:00"`. Attention : format PostgreSQL TEXT diffère légèrement de Python `.isoformat()` (espace vs T). Voir option alternative ci-dessous.

**Alternative recommandée pour les timestamps** :
```sql
TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS created_at
```
Cette approche produit exactement le format Python : `"2026-04-01T12:51:14.682000+00:00"`.

---

### 5. `AuthController.java` — Modifier ou créer

**Package** : `[votre.package].controller`

```java
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @GetMapping("/me")
    public ResponseEntity<CurrentUserDto> getMe(@AuthenticationPrincipal Object principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated");
        }
        if (principal instanceof CurrentUserDto user) {
            return ResponseEntity.ok(user);
        }
        throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated");
    }
}
```

**Attention** : si le token est absent et la route n'est pas protégée par Spring Security, `@AuthenticationPrincipal` retourne `null` → 401 "Not authenticated".

---

### 6. `SecurityConfig.java` — Configurer Spring Security

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   JwtAuthFilter jwtAuthFilter)
            throws Exception {
        return http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Routes publiques (Slice 01 + infra)
                .requestMatchers("/api/config/**", "/api/liveness", "/api/readiness").permitAll()
                // auth/me requiert un token valide
                .requestMatchers("/api/auth/me").authenticated()
                // Tout le reste : à configurer au fur et à mesure
                .anyRequest().permitAll()
            )
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .build();
    }
}
```

---

### 7. `application.yml` — Variables requises

```yaml
app:
  jwt:
    secret: ${JWT_SECRET}   # même valeur que Python — ne jamais hardcoder

spring:
  datasource:
    url: ${DATABASE_URL}
    # Supabase Supavisor : désactiver les prepared statements
    hikari:
      connection-init-sql: "SET statement_timeout = '30s'"
    properties:
      prepareThreshold: 0    # équivalent asyncpg statement_cache_size=0
```

---

## Choses à NE PAS faire

| # | Interdit | Raison |
|---|---|---|
| X-01 | Lire `sub` au lieu de `user_id` dans le payload JWT | Python stocke le user_id dans le claim custom `user_id`, pas dans `sub` |
| X-02 | Ajouter une vérification `deleted_at IS NULL` ou `banned_until < NOW()` | Python ne le fait pas — comportement intentionnel |
| X-03 | Mettre en cache l'utilisateur (Redis, in-memory) | Python est DB-fresh à chaque appel |
| X-04 | Retourner `password_hash`, `id` (UUID), `iban`, `stripe_*` | Jamais dans USER_FIELDS |
| X-05 | Utiliser `equalsIgnoreCase("bearer")` pour lire le token | Python est strict `startswith("Bearer ")` |
| X-06 | Retourner `camelCase` dans le JSON | Python retourne `snake_case` — frontend l'attend |
| X-07 | Convertir les timestamps en `ZonedDateTime` puis sérialiser | Risque de format `Z` au lieu de `+00:00` — utiliser `::text` SQL ou formater manuellement |
| X-08 | Retourner 404 si user non trouvé | Python retourne 401 "User not found" |
| X-09 | Utiliser `algorithms=["HS256","RS256"]` | Python accepte uniquement HS256 |
| X-10 | Mettre `cover_picture`, `cover_offset_y`, `cover_scale` dans USER_FIELDS | Non inclus dans Python USER_FIELDS malgré leur existence en DB |

---

## Validations à respecter

| # | Validation | Source |
|---|---|---|
| V-01 | `Authorization: Bearer <token>` → `auth.startsWith("Bearer ")` exact | BR-01 |
| V-02 | Fallback cookie `winek_token` si pas de header | BR-01 |
| V-03 | Algorithme HS256 uniquement | BR-02 |
| V-04 | Claims `user_id` + `exp` requis | BR-03 |
| V-05 | `"Token expired"` distinct de `"Invalid token"` distinct de `"Invalid token algorithm"` | BR-02, contrat API |
| V-06 | `"User not found"` si user absent de DB | contrat API |
| V-07 | Exactement 18 champs dans la réponse | USER_FIELDS |
| V-08 | Timestamps au format `"2026-04-01T12:51:14.682000+00:00"` | BR-09 |
| V-09 | `coach_tags`, `goals`, `user_roles` retournés comme tableaux JSON | BR-10 |
| V-10 | `"Not authenticated"` si token absent | BR contrat API |

---

## Critères de fin de tâche (definition of done)

- [ ] `GET /api/auth/me` avec token valide Python retourne HTTP 200 + 18 champs en snake_case
- [ ] `GET /api/auth/me` sans token retourne HTTP 401 `{"detail": "Not authenticated"}`
- [ ] `GET /api/auth/me` avec token expiré retourne HTTP 401 `{"detail": "Token expired"}`
- [ ] `GET /api/auth/me` avec token invalide retourne HTTP 401 `{"detail": "Invalid token"}`
- [ ] `GET /api/auth/me` avec mauvais algorithme retourne HTTP 401 `{"detail": "Invalid token algorithm"}`
- [ ] `GET /api/auth/me` avec user_id inexistant retourne HTTP 401 `{"detail": "User not found"}`
- [ ] Token émis par le backend Python est valide côté Java (même `JWT_SECRET`)
- [ ] Pas de champs sensibles dans la réponse (password_hash, iban, stripe_*, etc.)
- [ ] Timestamps au format `+00:00` et non `Z`
- [ ] Cookie `winek_token` fonctionnel comme fallback
- [ ] Les 17 cas de tests de `SLICE_02_TEST_CASES.md` passent

---

## Test de smoke end-to-end (à exécuter après implémentation)

```bash
# 1. Login via Python pour obtenir un token
TOKEN=$(curl -s -X POST "http://localhost:8001/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@winek.app","password":"WinekUser2024!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. Utiliser ce token Python contre le serveur Java
curl -s "http://localhost:<PORT_JAVA>/api/auth/me" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Attendu : HTTP 200 + user_demo001
```
