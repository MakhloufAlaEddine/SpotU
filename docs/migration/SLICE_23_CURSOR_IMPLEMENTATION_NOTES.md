# SLICE_23_CURSOR_IMPLEMENTATION_NOTES.md — Notes d'implémentation Cursor
> Basé sur `auth_routes.py`, `auth_utils.py`, `models.py:60–88`.
> Généré le 2026-04-13.

---

## Objectif

Créer le module d'authentification Java complet : `AuthController` (6 endpoints), `AuthService` (logique),
`JwtService` (encode/decode), `JwtAuthFilter` (extraction token requête), et les DTOs.
Après S23, le backend Java peut authentifier les utilisateurs et sécuriser tous les endpoints.

---

## 1. Architecture Java cible

```
src/main/java/com/spotu/
├── config/
│   └── SecurityConfig.java             ← 🔴 S23 (Spring Security + CORS)
├── controller/
│   └── AuthController.java             ← 🔴 S23 (6 endpoints)
├── service/
│   ├── AuthService.java                ← 🔴 S23 (register, login, google, change-password)
│   └── JwtService.java                 ← 🔴 S23 (encode, decode)
├── security/
│   ├── JwtAuthFilter.java              ← 🔴 S23 (OncePerRequestFilter)
│   └── EmergentOAuthClient.java        ← 🔴 S23 (appel HTTP Emergent)
├── repository/
│   └── UserRepository.java             ← 🔴 S23 (CRUD users)
├── model/
│   └── User.java                       ← 🔴 S23 (entity JPA)
├── dto/
│   ├── RegisterRequest.java            ← 🔴 S23
│   ├── LoginRequest.java               ← 🔴 S23
│   ├── GoogleAuthRequest.java          ← 🔴 S23
│   ├── ChangePasswordRequest.java      ← 🔴 S23
│   └── AuthResponse.java              ← 🔴 S23
```

---

## 2. JwtService — Encode/Decode

```java
@Service
public class JwtService {

    @Value("${jwt.secret}")
    private String jwtSecret;   // MÊME valeur que JWT_SECRET Python

    private static final String ALGORITHM = "HS256";
    private static final long EXPIRE_DAYS = 7;

    public String createToken(String userId, String role) {
        return Jwts.builder()
            .claim("user_id", userId)   // PAS "sub" — claim custom
            .claim("role", role)
            .setExpiration(Date.from(
                Instant.now().plus(EXPIRE_DAYS, ChronoUnit.DAYS)))
            .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }

    public Map<String, Object> decodeToken(String token) {
        try {
            Claims claims = Jwts.parserBuilder()
                .setSigningKey(Keys.hmacShaKeyFor(jwtSecret.getBytes()))
                .build()
                .parseClaimsJws(token)
                .getBody();

            String userId = claims.get("user_id", String.class);
            if (userId == null) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token");
            }
            return Map.of(
                "user_id", userId,
                "role", claims.get("role", String.class)
            );
        } catch (ExpiredJwtException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token expired");
        } catch (JwtException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid token");
        }
    }
}
```

**Dépendance Maven** : `io.jsonwebtoken:jjwt-api:0.12.6` + `jjwt-impl` + `jjwt-jackson`.

**PIÈGE CRITIQUE** : La clé de signature doit être IDENTIQUE byte-for-byte.
```yaml
# application.yml
jwt:
  secret: ${JWT_SECRET}  # MÊME variable d'environnement que Python
```

---

## 3. JwtAuthFilter — Extraction token

```java
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final UserRepository userRepository;

    // USER_FIELDS projection (18 champs)
    private static final String USER_FIELDS = "user_id, email, name, role, language, picture, " +
        "bio, phone, is_coach_verified, coach_tags, show_phone, show_reviews, " +
        "created_at, updated_at, sports_level, goals, user_roles, onboarding_done";

    @Override
    protected void doFilterInternal(HttpServletRequest request, ...) {
        String token = extractToken(request);
        if (token != null) {
            try {
                Map<String, Object> payload = jwtService.decodeToken(token);
                // Stocker dans request attributes pour require_auth
                request.setAttribute("jwt_payload", payload);
            } catch (ResponseStatusException e) {
                // Token invalide — ne pas bloquer les routes publiques
            }
        }
        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        // 1. Header Authorization: Bearer xxx
        String auth = request.getHeader("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) {
            return auth.substring(7);
        }
        // 2. Fallback : cookie "winek_token"
        if (request.getCookies() != null) {
            for (Cookie c : request.getCookies()) {
                if ("winek_token".equals(c.getName())) {
                    return c.getValue();
                }
            }
        }
        return null;
    }
}
```

---

## 4. AuthService — Logique métier

```java
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder; // BCryptPasswordEncoder
    private final EmergentOAuthClient emergentClient;

    // ── Register ────────────────────────────────────────────────────────

    public Map<String, Object> register(RegisterRequest req) {
        String email = req.getEmail().toLowerCase();

        if (userRepository.existsByEmail(email)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email already registered");
        }

        String userId = idGenerator.generate("user");
        String hash = passwordEncoder.encode(req.getPassword());

        userRepository.insertNewUser(userId, email, hash, req.getName().trim(),
            req.getLanguage() != null ? req.getLanguage() : "fr");

        Map<String, Object> user = userRepository.findByIdAsMap(userId);
        String token = jwtService.createToken(userId, "user");
        return Map.of("user", user, "token", token);
    }

    // ── Login ───────────────────────────────────────────────────────────

    public Map<String, Object> login(LoginRequest req) {
        String email = req.getEmail().toLowerCase();

        var creds = userRepository.findCredentialsByEmail(email);
        if (creds == null || !passwordEncoder.matches(req.getPassword(),
                creds.getPasswordHash() != null ? creds.getPasswordHash() : "")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }

        Map<String, Object> user = userRepository.findByIdAsMap(creds.getUserId());
        String token = jwtService.createToken(creds.getUserId(), (String) user.get("role"));
        return Map.of("user", user, "token", token);
    }

    // ── Google OAuth via Emergent ───────────────────────────────────────

    public Map<String, Object> googleAuth(String sessionId) {
        Map<String, String> sessionData = emergentClient.fetchSession(sessionId);
        String email = sessionData.get("email").toLowerCase();
        String name = sessionData.get("name");
        String picture = sessionData.get("picture");

        var existing = userRepository.findUserFieldsByEmail(email);
        if (existing != null) {
            // Update name + picture
            userRepository.updateNameAndPicture(email, name, picture);
            Map<String, Object> user = userRepository.findByEmailAsMap(email);
            String token = jwtService.createToken((String) user.get("user_id"), (String) user.get("role"));
            return Map.of("user", user, "token", token);
        }

        // Nouveau user
        String userId = idGenerator.generate("user");
        userRepository.insertGoogleUser(userId, email, name, picture);
        Map<String, Object> user = userRepository.findByIdAsMap(userId);
        String token = jwtService.createToken(userId, "user");
        return Map.of("user", user, "token", token);
    }

    // ── Change Password ─────────────────────────────────────────────────

    public Map<String, Object> changePassword(String userId, ChangePasswordRequest req) {
        String currentHash = userRepository.findPasswordHashByUserId(userId);
        if (currentHash == null || !passwordEncoder.matches(req.getCurrentPassword(), currentHash)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Mot de passe actuel incorrect");
        }
        String newHash = passwordEncoder.encode(req.getNewPassword());
        userRepository.updatePasswordHash(userId, newHash);
        return Map.of("success", true);
    }
}
```

---

## 5. EmergentOAuthClient

```java
@Slf4j
@Service
public class EmergentOAuthClient {

    private static final String EMERGENT_URL =
        "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data";

    private final RestTemplate restTemplate = new RestTemplate();

    public Map<String, String> fetchSession(String sessionId) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("X-Session-ID", sessionId);

        try {
            ResponseEntity<Map> response = restTemplate.exchange(
                EMERGENT_URL, HttpMethod.GET,
                new HttpEntity<>(headers), Map.class);

            Map<String, Object> body = response.getBody();
            if (body == null || body.containsKey("error")) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    body != null ? body.toString() : "Invalid Google session");
            }

            String email = (String) body.get("email");
            if (email == null || email.isBlank()) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                    "Could not retrieve user email from Google");
            }

            return Map.of(
                "email", email,
                "name", body.getOrDefault("name", "").toString(),
                "picture", body.getOrDefault("picture", "").toString()
            );
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid Google session");
        }
    }
}
```

---

## 6. BCrypt compatibilité Python ↔ Java

```
Python : bcrypt.hashpw(password.encode(), bcrypt.gensalt()) → "$2b$12$..."
Java   : BCryptPasswordEncoder().encode(password)            → "$2a$10$..."

Différences :
- Version prefix : "$2b$" (Python bcrypt) vs "$2a$" (Java BCrypt)
- Cost factor : 12 (Python default) vs 10 (Java default)

MAIS : BCrypt est cross-compatible. Java BCryptPasswordEncoder lit les hashes "$2b$".
       Et Python bcrypt lit les hashes "$2a$".
       → PAS DE PROBLÈME DE COMPATIBILITÉ.

Pour garantir la cohérence, configurer Java avec cost=12 :
  new BCryptPasswordEncoder(12)
```

---

## 7. SecurityConfig

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtFilter) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.configurationSource(corsConfig()))
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // Routes publiques
                .requestMatchers("/api/auth/register", "/api/auth/login", "/api/auth/google").permitAll()
                .requestMatchers("/api/auth/native-callback").permitAll()
                .requestMatchers("/api/subscription-plans").permitAll()
                .requestMatchers("/api/webhook/stripe").permitAll()
                .requestMatchers("/api/domains", "/api/tags/**").permitAll()
                .requestMatchers("/api/services").permitAll()
                // Tout le reste nécessite auth
                .anyRequest().authenticated()
            )
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

---

## 8. Pièges critiques

### P1 — JWT_SECRET partagé

```
CRITIQUE : La même clé doit être utilisée par Python ET Java.
Si le cutover est progressif (proxy), les tokens doivent être validés par les deux.
Configurer via la MÊME variable d'environnement.
```

### P2 — `verify_password("x", "")` → false en Python

```
Python bcrypt.checkpw(b"x", b"") → False (pas d'exception)
Java BCryptPasswordEncoder.matches("x", "") → IllegalArgumentException

EN JAVA : Ajouter un guard null/empty avant matches() :
  if (hash == null || hash.isBlank()) return false;
```

### P3 — Pydantic 422 vs Spring 400

```
Python Pydantic retourne HTTP 422 pour les erreurs de validation.
Spring Boot retourne HTTP 400 par défaut (MethodArgumentNotValidException).

Options :
a) Configurer Spring pour retourner 422 (compat stricte)
b) Adapter le front pour accepter 400 ET 422
Recommandation : option (a) via @ExceptionHandler.
```

### P4 — `coach_tags` colonne JSONB

```
register insère coach_tags = '[]'::jsonb.
En JPA, utiliser @Type(JsonType.class) ou un converter custom.
Le READ (USER_FIELDS) désérialise en List.
```

### P5 — Rate limiting

```
Python utilise SlowAPI (basé sur slowapi/starlette).
Java : bucket4j, Resilience4j, ou @RateLimiter custom.
Les limites exactes : 5/min (register, login), 10/min (google).
```

---

## 9. Critères de done

| # | Critère | Tests |
|---|---|---|
| D1 | POST /register crée un user + retourne JWT | TC-REG-01 |
| D2 | Email lowercase | TC-REG-03, TC-LOG-05 |
| D3 | Email déjà existant → 400 | TC-REG-02 |
| D4 | Password < 6 → 422 | TC-REG-04 |
| D5 | POST /login retourne JWT | TC-LOG-01 |
| D6 | Login credentials invalides → 401 (même message) | TC-LOG-02, TC-LOG-03 |
| D7 | POST /google crée OU met à jour user | TC-GOO-01, TC-GOO-02 |
| D8 | Google session invalide → 401 | TC-GOO-03, TC-GOO-04, TC-GOO-05 |
| D9 | GET /me avec token valide → user | TC-ME-01 |
| D10 | Token absent/expiré/invalide → 401 | TC-ME-02, TC-ME-03, TC-ME-04 |
| D11 | Cookie winek_token fallback | TC-ME-06 |
| D12 | POST /logout → success:true | TC-OUT-01 |
| D13 | PUT /change-password vérifie ancien hash | TC-PWD-01, TC-PWD-02 |
| D14 | BCrypt hashes Python lisibles par Java | Test cross-compat |
| D15 | JWT tokens Python décodables par Java | TC-JWT-02 (même secret) |
| D16 | Rate limiting fonctionnel | TC-REG-09, TC-LOG-06 |

---

## 10. Relation avec les Slices

| Slice | Interaction |
|---|---|
| **TOUTES (S02–S22)** | Utilisent `require_auth()` / `require_role()` implémentés dans S23 |
| S24 (futur) | PUT /profile utilise require_auth de S23 |
| S25 (futur) | Upload utilise require_auth de S23 |
