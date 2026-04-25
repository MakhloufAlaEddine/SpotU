# SLICE_32_CURSOR_IMPLEMENTATION_NOTES.md — Notes Java/Spring Boot Webhook Infrastructure
> Basé sur `payment_routes.py:356–405`, `webhook_handlers.py:80–117, 979–1071`, BR-32.01 à BR-32.15.
> Généré le 2026-04-20.
>
> ⚠️ **Reproduire 1:1 le comportement Python.** Pas de retry handler, pas de DLQ, pas de wrapping global @ControllerAdvice qui convertirait les exceptions en 500.

---

## 1. Structure Spring Boot

```
src/main/java/com/spotu/webhook/
├── controller/
│   └── StripeWebhookController.java       ← endpoint POST /api/webhook/stripe
├── service/
│   ├── WebhookDispatcherService.java      ← dispatch() + idempotence + try/catch global
│   ├── StripeSignatureService.java        ← parseEvent + verify
│   └── handlers/                          ← STUB en Slice 32 (vides)
│       ├── PaymentEventHandler.java       ← @Component, set vide _PAYMENT_EVENTS
│       ├── ChargeEventHandler.java        ← idem
│       └── SubscriptionEventHandler.java  ← idem
├── repository/
│   └── StripeWebhookEventRepository.java  ← claimEvent + markDone
└── dto/
    └── PendingNotif.java                  ← record (vide en S32)
```

---

## 2. Controller

```java
@RestController
@RequestMapping("/api/webhook")
@RequiredArgsConstructor
public class StripeWebhookController {

    private final StripeSignatureService signatureService;
    private final WebhookDispatcherService dispatcher;
    private static final Logger log = LoggerFactory.getLogger(StripeWebhookController.class);

    @PostMapping(value = "/stripe", consumes = MediaType.ALL_VALUE)
    public Map<String, Object> stripeWebhook(
            @RequestBody byte[] body,
            @RequestHeader(value = "Stripe-Signature", required = false) String signature) {

        // ── 1. Vérification signature OU parse JSON brut (mode dev)
        ParsedEvent parsed = signatureService.parse(body, signature);
        // throws BadRequestException("Signature invalide : ...") OR ("Body JSON invalide")

        // ── 2. Extraction id/type/obj
        String eventId   = parsed.id();
        String eventType = parsed.type();
        if (eventId == null || eventId.isEmpty() || eventType == null || eventType.isEmpty()) {
            throw new BadRequestException("event id/type manquant");
        }

        log.info("Webhook reçu : type={} | id={}", eventType, eventId);

        // ── 3. Dispatch (idempotence + handlers stub)
        return dispatcher.dispatch(eventId, eventType, parsed.obj());
    }
}
```

### `@RequestBody byte[]`
**Critique** : utiliser `byte[]` pour préserver les bytes bruts. Spring NE va PAS désérialiser via Jackson.

### Pas de `@PreAuthorize`
SecurityConfig doit `permitAll()` sur ce path.

---

## 3. SecurityConfig

```java
@Configuration
public class WebhookSecurityConfig {
    @Bean @Order(1)
    SecurityFilterChain webhookChain(HttpSecurity http) throws Exception {
        http.securityMatcher("/api/webhook/**")
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS));
        return http.build();
    }
}
```

> ⚠️ **CSRF disabled** sur ce path : Stripe ne peut pas fournir de token CSRF.

---

## 4. StripeSignatureService

```java
@Service
@RequiredArgsConstructor
public class StripeSignatureService {

    @Value("${stripe.webhook.secret:}")
    private String webhookSecret;

    private final ObjectMapper objectMapper;
    private static final Logger log = LoggerFactory.getLogger(StripeSignatureService.class);

    public ParsedEvent parse(byte[] body, String signature) {
        if (webhookSecret != null && !webhookSecret.isEmpty()) {
            // Mode prod — signature stricte
            try {
                Event event = Webhook.constructEvent(
                    new String(body, StandardCharsets.UTF_8),
                    signature,
                    webhookSecret
                );
                Object obj = event.getDataObjectDeserializer()
                    .getObject()
                    .orElse(null);  // peut être null si type Stripe inconnu
                return new ParsedEvent(event.getId(), event.getType(), obj);
            } catch (SignatureVerificationException e) {
                log.warn("Signature webhook invalide : {}", e.getMessage());
                throw new BadRequestException("Signature invalide : " + e.getMessage());
            }
        } else {
            // Mode dev — parse JSON brut
            try {
                Map<String, Object> map = objectMapper.readValue(body, Map.class);
                String id = (String) map.getOrDefault("id", "");
                String type = (String) map.getOrDefault("type", "");
                Map<String, Object> data = (Map<String, Object>) map.getOrDefault("data", Map.of());
                Object obj = data.getOrDefault("object", Map.of());
                return new ParsedEvent(id, type, obj);
            } catch (IOException e) {
                throw new BadRequestException("Body JSON invalide");
            }
        }
    }
}

public record ParsedEvent(String id, String type, Object obj) {}
```

---

## 5. WebhookDispatcherService

```java
@Service
@RequiredArgsConstructor
public class WebhookDispatcherService {

    private final StripeWebhookEventRepository repo;
    private final PaymentEventHandler paymentHandler;
    private final ChargeEventHandler chargeHandler;
    private final SubscriptionEventHandler subscriptionHandler;
    private final NotificationService notifService;  // pour pending_notifs (S33+)
    private static final Logger log = LoggerFactory.getLogger(WebhookDispatcherService.class);

    public Map<String, Object> dispatch(String eventId, String eventType, Object obj) {
        String relatedId = null;
        List<PendingNotif> pendingNotifs = new ArrayList<>();   // toujours vide en S32

        // ── 1. Idempotence (REQUIRES_NEW pour commit immédiat)
        boolean isNew = claimEventNewTx(eventId, eventType);
        if (!isNew) {
            log.debug("Webhook doublon ignoré : event_id={} type={}", eventId, eventType);
            Map<String,Object> resp = new LinkedHashMap<>();
            resp.put("received", true);
            resp.put("idempotent_skip", true);
            return resp;
        }

        // ── 2. Dispatch (handlers stub en S32)
        try {
            // Slice 32 : sets vides, aucun handler ne match
            if (chargeHandler.handles(eventType)) {
                chargeHandler.handle(eventType, obj, /* paymentId */ null, pendingNotifs);
            }
            if (paymentHandler.handles(eventType)) {
                paymentHandler.handle(eventType, obj, null, null, pendingNotifs);
            }
            if (subscriptionHandler.handles(eventType)) {
                String subRelated = subscriptionHandler.handle(eventType, obj, pendingNotifs);
                relatedId = (relatedId != null) ? relatedId : subRelated;
            }

            repo.markDone(eventId, "success", relatedId, null);

        } catch (Exception exc) {
            log.error("Erreur handler webhook event={} id={} : {}", eventType, eventId, exc.getMessage(), exc);
            String trunc = exc.getMessage() != null
                          ? exc.getMessage().substring(0, Math.min(exc.getMessage().length(), 500))
                          : null;
            repo.markDone(eventId, "error", relatedId, trunc);
            // PAS de re-throw — Stripe doit recevoir 200
        }

        // ── 3. Envoi notifications hors transaction (vide en S32)
        for (PendingNotif notif : pendingNotifs) {
            try {
                notifService.storeNotification(
                    notif.userId(), notif.type(), notif.title(), notif.body(), notif.data()
                );
                log.info("Notification envoyée : type={} | user={}", notif.type(), notif.userId());
            } catch (Exception e) {
                log.warn("Erreur envoi notification type={} user={} : {}",
                         notif.type(), notif.userId(), e.getMessage());
            }
        }

        return Map.of("received", true);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    protected boolean claimEventNewTx(String eventId, String eventType) {
        return repo.claimEvent(eventId, eventType) == 1;
    }
}
```

### Pourquoi `REQUIRES_NEW` sur `claimEvent`
Forcer le commit immédiat de l'INSERT avant le dispatch des handlers. Si le dispatch throw, l'event reste claimé en `processing` puis flippé `error` — pas perdu.

---

## 6. Handlers stub (Slice 32)

```java
@Component
public class PaymentEventHandler {
    private static final Set<String> EVENTS = Set.of();   // VIDE en S32

    public boolean handles(String type) { return EVENTS.contains(type); }

    public void handle(String type, Object obj, String paymentId, String bookingId,
                       List<PendingNotif> notifs) {
        // STUB en S32 — implémenté en S33
    }
}

@Component
public class ChargeEventHandler {
    private static final Set<String> EVENTS = Set.of();   // VIDE
    public boolean handles(String type) { return EVENTS.contains(type); }
    public void handle(String type, Object obj, String paymentId,
                       List<PendingNotif> notifs) {
        // STUB
    }
}

@Component
public class SubscriptionEventHandler {
    private static final Set<String> EVENTS = Set.of();   // VIDE
    public boolean handles(String type) { return EVENTS.contains(type); }
    public String handle(String type, Object obj, List<PendingNotif> notifs) {
        return null;   // STUB
    }
}
```

> Slice 33 populera `EVENTS` pour PaymentEventHandler. Slice 34 pour Charge. Slice 35 pour Subscription.

---

## 7. Repository

```java
@Repository
public interface StripeWebhookEventRepository {

    @Modifying
    @Query(value = """
        INSERT INTO stripe_webhook_events
               (event_id, event_type, status, processed_at, updated_at)
        VALUES (:eventId, :eventType, 'processing', NOW(), NOW())
        ON CONFLICT (event_id) DO NOTHING
    """, nativeQuery = true)
    int claimEvent(@Param("eventId") String eventId,
                   @Param("eventType") String eventType);

    @Modifying
    @Query(value = """
        UPDATE stripe_webhook_events
           SET status        = :status,
               related_id    = :relatedId,
               error_message = :errorMessage,
               updated_at    = NOW()
         WHERE event_id      = :eventId
    """, nativeQuery = true)
    int markDone(@Param("eventId") String eventId,
                 @Param("status") String status,
                 @Param("relatedId") String relatedId,
                 @Param("errorMessage") String errorMessage);
}
```

---

## 8. PendingNotif record (vide en S32 mais structure prête)

```java
public record PendingNotif(
    String userId,
    String type,
    String title,
    String body,
    Map<String, Object> data
) {}
```

---

## 9. Exception handler

```java
@ControllerAdvice
public class WebhookExceptionHandler {

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<Map<String,String>> badRequest(BadRequestException e) {
        return ResponseEntity.status(400).body(Map.of("detail", e.getMessage()));
    }

    // PAS d'exception handler générique 500 sur ce controller —
    // les exceptions handlers sont catchées dans dispatch()
}
```

> ⚠️ **Critique** : si un autre `@ControllerAdvice` global existe, l'exclure pour le path `/api/webhook/stripe` OU s'assurer qu'il convertit certaines exceptions en 400 mais **pas en 500** pour ne pas faire spammer Stripe.

---

## 10. Configuration

```yaml
# application.yml
stripe:
  api:
    key: ${STRIPE_API_KEY:}
  webhook:
    secret: ${STRIPE_WEBHOOK_SECRET:}

logging:
  level:
    com.spotu.webhook: DEBUG
```

### Stripe-java dependency
```xml
<dependency>
  <groupId>com.stripe</groupId>
  <artifactId>stripe-java</artifactId>
  <version>28.0.0</version>
</dependency>
```

---

## 11. Pièges à éviter

| # | Piège | Mitigation |
|---|---|---|
| 1 | Utiliser `@RequestBody Map` au lieu de `byte[]` → Jackson consomme stream → signature fail | `@RequestBody byte[]` obligatoire |
| 2 | Re-throw des exceptions handlers → Stripe retry exponentiel | try/catch dans dispatch() + log + return 200 |
| 3 | `@ControllerAdvice` global qui convertit Exception en 500 | Exclure le path webhook ou exception handler dédié |
| 4 | Oublier `@Transactional(REQUIRES_NEW)` sur claimEvent | Risque de re-traitement si la transaction parente roll-back |
| 5 | Comparer `int retour` à `> 0` au lieu de `== 1` | `claimEvent() == 1` strictement |
| 6 | Ignorer le mode dev (parse JSON brut sans secret) | If/else explicite sur `webhookSecret` |
| 7 | Tronquer `error_message` à 500 chars avec une mauvaise méthode (substring sans bound check) | `Math.min(msg.length(), 500)` |
| 8 | Mettre à jour `processed_at` dans markDone | UPDATE n'inclut pas `processed_at` — compat stricte |
| 9 | CSRF activé sur le path webhook | `csrf.disable()` dans SecurityConfig |
| 10 | JWT filter qui throw 401 quand pas de token | SecurityConfig `permitAll()` + filter conditionnel |
| 11 | Convertir bytes → String avant `constructEvent` avec une charset différente d'UTF-8 | `new String(body, StandardCharsets.UTF_8)` |
| 12 | Logger qui sérialise `obj` Stripe en log (avec PII) | Logger uniquement `event_type` et `event_id`, pas `obj` |
| 13 | Tenter de valider le format `event_id` (regex `evt_...`) | Pas de validation Python, ne pas ajouter |

---

## 12. Critères de Done

| # | Critère | Test |
|---|---|---|
| 1 | Endpoint exposé sans auth | T32-01 |
| 2 | Signature valide → 200 | T32-01 |
| 3 | Signature invalide → 400 | T32-05 |
| 4 | Mode dev sans secret accepte JSON brut | T32-02, T32-08 |
| 5 | event_id/event_type manquant → 400 | T32-09, T32-10 |
| 6 | Idempotence atomique via PK | T32-03, T32-04 |
| 7 | Doublon → `idempotent_skip: true` | T32-03 |
| 8 | Always-200 sauf 400 sig/body | T32-18 |
| 9 | `error_message` tronqué à 500 chars | T32-19 |
| 10 | Logs format `\| ` séparateur | T32-23 |
| 11 | `processed_at` non-modifié à mark_done | T32-24 |
| 12 | Handlers stub vides : aucun side-effect métier | T32-11..16 |
| 13 | `pending_notifs` boucle présente mais vide en S32 | Inspection code |
| 14 | Aucun UPDATE payments/bookings | Assertion DB |
| 15 | Logs WARNING/INFO/DEBUG/EXCEPTION conformes | T32-23 |

---

## 13. Validation finale

- [ ] 28 cas T32 passent
- [ ] Aucune modification aux endpoints S30/S31 (booking pay, checkout status)
- [ ] Stripe Dashboard webhook test → 200 avec event valide
- [ ] Test concurrence (2 livraisons // ) → 1 seule row en DB
- [ ] Mode dev fonctionne (secret vide → JSON brut)
- [ ] Logs visibles avec format Python-compatible
- [ ] `stripe_webhook_events` se remplit en `success` pour TOUS les events (handlers stub)
- [ ] **Préparation S33** : structure `_PAYMENT_EVENTS` set + handler interface en place, prête à être populée

---

## 14. Roadmap Slice 32 → 33 → 34 → 35

| Slice | Contenu | Modification de cette infra |
|---|---|---|
| **S32 (cette slice)** | Infra + dispatcher squelette + handlers stub | — |
| **S33 (suivante)** | Populate `_PAYMENT_EVENTS` + implémenter `PaymentEventHandler.handle` (payment_intent.* + checkout.session.completed) | Aucun changement infra |
| **S34** | Populate `_CHARGE_EVENTS` + `ChargeEventHandler` (refunds) | Aucun changement infra |
| **S35** | Populate `_SUBSCRIPTION_EVENTS` + `SubscriptionEventHandler` (subscriptions/invoices) | Aucun changement infra |

> **L'infrastructure de S32 ne devrait JAMAIS être modifiée par S33/34/35** sauf bug. C'est le contrat de stabilité de cette slice.
