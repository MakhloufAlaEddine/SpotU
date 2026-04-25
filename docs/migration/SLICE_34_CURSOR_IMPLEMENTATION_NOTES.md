# SLICE_34_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Payment Reads
> Basé sur `routes/payment_routes.py:32–80`, `auth_utils.py:71–83`, `database.py:53–65`, BR-34.01 à BR-34.15.
> Généré le 2026-04-25.
>
> ⚠️ **Reproduire 1:1 le comportement Python.** Pas de pagination, pas de filtres, pas de wrapper. SELECT * complet.

---

## 1. Structure Spring Boot

```
src/main/java/com/spotu/payment/
├── controller/
│   └── PaymentReadController.java        ← GET /api/payments/me + /api/payments/{id}
├── service/
│   ├── PaymentReadService.java
│   └── PaymentDeserializer.java          ← équivalent _deserialize
├── repository/
│   └── PaymentReadRepository.java        ← 2 queries native
├── dto/
│   ├── PaymentListItemDto.java           ← avec payer_name + receiver_name
│   └── PaymentDetailDto.java             ← sans names
├── auth/
│   ├── AuthService.java                  ← require_auth (Bearer + cookie)
│   └── User.java                         ← record (user_id, role, ...)
└── config/
    └── PaymentJacksonConfig.java         ← snake_case + +00:00 datetime
```

---

## 2. Controller

```java
@RestController
@RequestMapping("/api/payments")
@RequiredArgsConstructor
public class PaymentReadController {

    private final AuthService authService;
    private final PaymentReadService paymentService;

    @GetMapping("/me")
    public List<PaymentListItemDto> myPayments(HttpServletRequest request) {
        User user = authService.requireAuth(request);
        return paymentService.findByUser(user.userId());
    }

    @GetMapping("/{paymentId}")
    public PaymentDetailDto getPayment(@PathVariable String paymentId,
                                        HttpServletRequest request) {
        User user = authService.requireAuth(request);
        return paymentService.findByIdWithPermissions(paymentId, user);
    }
}
```

> ⚠️ **PAS de `@PreAuthorize`** — la logique de permissions est dans le service (compat stricte avec Python qui le fait après le SELECT).

---

## 3. AuthService (BR-34.01)

```java
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepo;
    private final JwtDecoder jwtDecoder;

    public User requireAuth(HttpServletRequest request) {
        String token = extractToken(request);
        if (token == null || token.isEmpty()) {
            throw new UnauthorizedException("Not authenticated");
        }
        JwtPayload payload;
        try {
            payload = jwtDecoder.decode(token);
        } catch (JwtException e) {
            throw new UnauthorizedException("Invalid token");
        }
        return userRepo.findById(payload.userId())
            .orElseThrow(() -> new UnauthorizedException("User not found"));
    }

    private String extractToken(HttpServletRequest req) {
        String h = req.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) return h.substring(7);
        Cookie[] cookies = req.getCookies();
        if (cookies != null) {
            for (Cookie c : cookies) {
                if ("winek_token".equals(c.getName())) return c.getValue();
            }
        }
        return null;
    }
}
```

> ⚠️ Bearer **prioritaire** sur cookie (cohérence Python `get_token_from_request`).

---

## 4. PaymentReadService

```java
@Service
@RequiredArgsConstructor
public class PaymentReadService {

    private final PaymentReadRepository repo;
    private final PaymentDeserializer deserializer;

    @Transactional(readOnly = true)
    public List<PaymentListItemDto> findByUser(String userId) {
        return repo.findByUserWithNames(userId).stream()
            .map(deserializer::deserialize)
            .toList();
    }

    @Transactional(readOnly = true)
    public PaymentDetailDto findByIdWithPermissions(String paymentId, User user) {
        // 1. SELECT (404 si null)
        PaymentDetailDto p = repo.findById(paymentId)
            .orElseThrow(() -> new NotFoundException("Payment not found"));

        // 2. Permissions (BR-34.03 — 3 conditions OR)
        boolean isPayer    = user.userId().equals(p.payerUserId());
        boolean isReceiver = user.userId().equals(p.receiverUserId());
        boolean isAdmin    = "admin".equals(user.role());

        if (!isPayer && !isReceiver && !isAdmin) {
            throw new ForbiddenException("Access denied");
        }

        // 3. Désérialisation
        return deserializer.deserialize(p);
    }
}
```

> ⚠️ Ordre **404 avant 403** (BR-34.04).

---

## 5. PaymentReadRepository

```java
@Repository
public interface PaymentReadRepository {

    @Query(value = """
        SELECT p.*,
               u_pay.name  AS payer_name,
               u_recv.name AS receiver_name
          FROM payments p
          LEFT JOIN users u_pay  ON u_pay.user_id  = p.payer_user_id
          LEFT JOIN users u_recv ON u_recv.user_id = p.receiver_user_id
         WHERE p.payer_user_id = :uid OR p.receiver_user_id = :uid
         ORDER BY p.created_at DESC
    """, nativeQuery = true)
    List<PaymentListItemDto> findByUserWithNames(@Param("uid") String userId);

    @Query(value = "SELECT * FROM payments WHERE payment_id = :id", nativeQuery = true)
    Optional<PaymentDetailDto> findById(@Param("id") String paymentId);
}
```

> ⚠️ **`SELECT *`** strict (BR-34.10/T34-21). Si le DTO n'a pas un champ qui existe en DB → erreur de mapping. **Maintenir le DTO miroir complet** ou utiliser `Map<String,Object>` + sérialisation dynamique.

### Alternative dynamique (Map)

```java
@Query(value = "SELECT * FROM payments WHERE payment_id = :id", nativeQuery = true)
Optional<Map<String,Object>> findByIdRaw(@Param("id") String id);
```

Puis le service convertit le Map en JSON tel quel via Jackson. **Plus tolérant aux ajouts de colonnes futures** mais moins typé.

---

## 6. DTOs

### PaymentListItemDto (avec names)
```java
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record PaymentListItemDto(
    String paymentId, String bookingId,
    String payerUserId, String receiverUserId,
    BigDecimal amount, String currency, String status,
    String stripeCheckoutSessionId, String stripePaymentIntentId, String stripeChargeId,
    @JdbcTypeCode(SqlTypes.JSON) Map<String,Object> metadata,
    @JdbcTypeCode(SqlTypes.JSON) Object pricingRuleSnapshot,
    String idempotencyKey,
    OffsetDateTime createdAt, OffsetDateTime updatedAt,
    String payerName, String receiverName
) {}
```

### PaymentDetailDto (sans names)
```java
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record PaymentDetailDto(
    String paymentId, String bookingId,
    String payerUserId, String receiverUserId,
    BigDecimal amount, String currency, String status,
    String stripeCheckoutSessionId, String stripePaymentIntentId, String stripeChargeId,
    @JdbcTypeCode(SqlTypes.JSON) Map<String,Object> metadata,
    Object pricingRuleSnapshot,
    String idempotencyKey,
    OffsetDateTime createdAt, OffsetDateTime updatedAt
) {}
```

> ⚠️ **`pricingRuleSnapshot`** typé `Object` car peut être string OU dict selon stockage DB.

---

## 7. PaymentDeserializer (BR-34.08)

```java
@Component
@RequiredArgsConstructor
public class PaymentDeserializer {

    private final ObjectMapper objectMapper;

    public <T> T deserialize(T dto) {
        // Reflexion ou cast pour accéder à pricing_rule_snapshot
        // Si String → parse en Map
        if (dto instanceof PaymentDetailDto d) {
            Object snap = d.pricingRuleSnapshot();
            if (snap instanceof String s && !s.isEmpty()) {
                try {
                    Object parsed = objectMapper.readValue(s, Object.class);
                    // Reconstruire le record (records sont immutables)
                    return (T) new PaymentDetailDto(
                        d.paymentId(), d.bookingId(), d.payerUserId(), d.receiverUserId(),
                        d.amount(), d.currency(), d.status(),
                        d.stripeCheckoutSessionId(), d.stripePaymentIntentId(), d.stripeChargeId(),
                        d.metadata(), parsed, d.idempotencyKey(),
                        d.createdAt(), d.updatedAt()
                    );
                } catch (IOException e) {
                    // Si parse échoue, garder la string
                    return dto;
                }
            }
        }
        // Idem PaymentListItemDto
        return dto;
    }
}
```

> ⚠️ Approche records = immutables → reconstruction. Alternative : utiliser des classes mutables avec setters, ou un DTO `Map<String,Object>` plus flexible.

**Approche plus simple : Map dynamique**
```java
public Map<String,Object> deserialize(Map<String,Object> raw) {
    Object snap = raw.get("pricing_rule_snapshot");
    if (snap instanceof String s && !s.isEmpty()) {
        try {
            raw.put("pricing_rule_snapshot", objectMapper.readValue(s, Object.class));
        } catch (IOException ignored) {}
    }
    return raw;
}
```

Recommandation : **Map dynamique** pour cette slice (compat stricte SELECT * + désérialisation conditionnelle).

---

## 8. Configuration Jackson (BR-34.09, BR-34.10)

```java
@Configuration
public class PaymentJacksonConfig {

    @Bean
    @Primary
    public ObjectMapper objectMapper() {
        JavaTimeModule timeModule = new JavaTimeModule();

        // Format datetime "+00:00" au lieu de "Z"
        timeModule.addSerializer(OffsetDateTime.class, new JsonSerializer<>() {
            @Override
            public void serialize(OffsetDateTime value, JsonGenerator gen, SerializerProvider sp) throws IOException {
                gen.writeString(value.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
            }
        });

        return new ObjectMapper()
            .registerModule(timeModule)
            .configure(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, false)
            .configure(SerializationFeature.WRITE_BIGDECIMAL_AS_PLAIN, true)
            .setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
    }
}
```

> ⚠️ Si la config snake_case est globale, vérifier qu'elle ne casse pas d'autres endpoints. Sinon, utiliser `@JsonNaming` par DTO uniquement.

---

## 9. Exception handlers

```java
@ControllerAdvice
public class PaymentExceptionHandler {

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<Map<String,String>> unauthorized(UnauthorizedException e) {
        return ResponseEntity.status(401).body(Map.of("detail", e.getMessage()));
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<Map<String,String>> forbidden(ForbiddenException e) {
        return ResponseEntity.status(403).body(Map.of("detail", e.getMessage()));
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<Map<String,String>> notFound(NotFoundException e) {
        return ResponseEntity.status(404).body(Map.of("detail", e.getMessage()));
    }
}
```

> ⚠️ Format `{"detail": "..."}` strict (compat FastAPI).

---

## 10. Sécurité

### SecurityConfig
```java
@Bean
SecurityFilterChain paymentSecurityFilterChain(HttpSecurity http) throws Exception {
    http.securityMatcher("/api/payments/me", "/api/payments/{paymentId:[a-zA-Z0-9_]+}")
        .csrf(csrf -> csrf.disable())
        .authorizeHttpRequests(auth -> auth.anyRequest().permitAll());  // Auth gérée par AuthService
    return http.build();
}
```

> ⚠️ **`permitAll()`** car l'auth est faite via `AuthService.requireAuth` (compat stricte Python qui ne use pas Spring Security middleware).

> Alternative recommandée si Spring Security adopté : configurer un `OncePerRequestFilter` qui populate `SecurityContext` à partir du JWT, et `@AuthenticationPrincipal User user` dans le controller. **Choisir une approche cohérente avec les autres slices**.

---

## 11. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Ajouter pagination `?page=&size=` | NON. Compat stricte (BR-34.05). |
| 2 | Filtrer les colonnes "internes" (`stripe_secret`, `idempotency_key`) | NON. `SELECT *` complet (BR-34.10/T34-21). |
| 3 | Wrapper `{"data": [...], "total": N}` | NON. Liste/objet direct. |
| 4 | Retourner 404 sur liste vide | NON. `[]`. |
| 5 | INNER JOIN au lieu de LEFT JOIN | NON. LEFT JOIN obligatoire. |
| 6 | Inverser ordre 404/403 (uniformiser à 404) | NON. Compat stricte (BR-34.04). |
| 7 | Utiliser camelCase au lieu de snake_case | NON. `payer_user_id` etc. |
| 8 | Format datetime `Z` au lieu de `+00:00` | NON. Configurer Jackson explicitement. |
| 9 | Ignorer le cookie `winek_token` | NON. Auth dual obligatoire. |
| 10 | Ajouter `payer_name` sur `/{id}` | NON. Asymétrie volontaire. |
| 11 | Désérialiser `pricing_rule_snapshot` toujours (même si déjà dict) | Conditionnel sur `instanceof String`. |
| 12 | Cache HTTP shared (CDN) | NON. User-scope. |
| 13 | `@PreAuthorize` Spring Security | NON. Logique applicative explicite. |
| 14 | Fusionner `PaymentListItemDto` et `PaymentDetailDto` | NON. Champs différents (names). |
| 15 | Convert Decimal en string JSON | NON. number JSON (T34-24). |

---

## 12. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | `GET /api/payments/me` exige auth | T34-10 |
| 2 | `/me` retourne uniquement les paiements du user (payer OR receiver) | T34-01 |
| 3 | `/me` ordre `created_at DESC` | T34-01 |
| 4 | `/me` inclut `payer_name` + `receiver_name` (LEFT JOIN) | T34-06 |
| 5 | `/me` retourne `[]` si vide | T34-02 |
| 6 | `/{id}` retourne 200 si user payer/receiver/admin | T34-07, T34-08, T34-09 |
| 7 | `/{id}` 404 si payment introuvable | T34-16 |
| 8 | `/{id}` 403 si user lambda sur payment d'un autre | T34-17 |
| 9 | `/{id}` 404 avant 403 | T34-18 |
| 10 | Auth Bearer header fonctionne | T34-01 |
| 11 | Auth cookie `winek_token` fonctionne | T34-14 |
| 12 | Bearer prioritaire sur cookie | T34-15 |
| 13 | JWT expiré → 401 | T34-12 |
| 14 | User supprimé → 401 "User not found" | T34-13 |
| 15 | Format datetime `+00:00` | T34-04 |
| 16 | `pricing_rule_snapshot` désérialisé conditionnel | T34-05 |
| 17 | Tous les champs DB retournés (`SELECT *`) | T34-21 |
| 18 | Pas de `payer_name` sur `/{id}` | T34-22 |
| 19 | Snake_case noms champs | T34-23 |
| 20 | Decimal → number JSON | T34-24 |

---

## 13. Validation finale

- [ ] 24 cas T34 passent
- [ ] Régression S30 : payment créé en S30 visible immédiatement (T34-R1)
- [ ] Régression S33 : payment captured via webhook visible (T34-R2)
- [ ] Régression S31 : payment captured via S31 visible (T34-R3)
- [ ] Front mobile peut consommer `/me` et `/{id}` sans changement client
- [ ] Test charset UTF-8 (T34-S3)
- [ ] Test 1000 paiements (T34-S1)
- [ ] Snapshot diff : capturer une réponse Python prod-like et asserter `JSONAssert STRICT` contre la réponse Java

---

## 14. Roadmap S34 → S35 → S36

| Slice | Contenu | Réutilise S34 |
|---|---|---|
| **S34 (cette slice)** | Payment reads | — |
| **S35** | Webhook charge events (refunds) | Pattern `_resolve_payment_id` (déjà porté en S33) |
| **S36 (futur)** | Booking reads (`/bookings/me`, `/bookings/{id}`) | **Pattern S34 réutilisé** : auth dual + WHERE OR + permissions 3-OR |
| **S37 (futur)** | Service reads (`/services/me`, etc.) | Idem |

> **L'API S34 (PaymentReadController) ne devrait JAMAIS être modifiée par S35+**. Pattern réutilisable mais cloisonné par domaine.
