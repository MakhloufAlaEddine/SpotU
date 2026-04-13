# FINAL_CURSOR_NOTES.md — Consignes pour fermer les gaps avec Cursor
> Généré le 2026-04-13.

---

## Principes pour Cursor

### 1. Structure du projet Java

```
src/main/java/com/spotu/
├── config/           ← StripeConfig (S19), SecurityConfig, WebSocketConfig
├── controller/       ← 1 controller par domaine
├── service/          ← Logique métier (pas dans les controllers)
├── repository/       ← JPA repositories (@Query native pour les SQL complexes)
├── model/            ← Entities JPA (1 par table)
├── dto/              ← Request/Response DTOs
├── security/         ← JWT filter, auth utils
├── websocket/        ← WebSocket handlers
├── worker/           ← @Scheduled workers
└── util/             ← Helpers (IdGenerator, PricingEngine)
```

### 2. Convention de nommage Python → Java

| Python | Java |
|---|---|
| `snake_case` (routes, champs) | `camelCase` (code), `snake_case` (JSON — @JsonProperty) |
| `booking_id` | `bookingId` (code), `"booking_id"` (JSON response) |
| `require_auth(request, pool)` | `authService.requireAuth(request)` |
| `require_role(request, pool, "admin")` | `authService.requireRole(request, "admin")` |
| `new_id("bkg")` | `idGenerator.generate("bkg")` |
| `get_pool()` → `pool.acquire()` | `@Autowired` repository (connection pool géré par Spring) |

### 3. Pattern SQL → JPA

| Pattern Python | Pattern Java |
|---|---|
| `conn.fetchrow(sql, params)` | `repository.findXxx(params)` → Optional<Entity> |
| `conn.fetch(sql, params)` | `repository.findAllXxx(params)` → List<Entity> |
| `conn.execute(sql, params)` | `repository.save(entity)` ou `@Modifying @Query` |
| `conn.fetchval(sql, params)` | `repository.countXxx(params)` → int |
| `async with conn.transaction()` | `@Transactional` (Spring) |
| `FOR UPDATE NOWAIT` | `@Lock(LockModeType.PESSIMISTIC_WRITE)` + `@QueryHints(timeout)` |
| `FOR UPDATE SKIP LOCKED` | Requête native obligatoire (JPA ne supporte pas) |

---

## Consignes par bloc

### BLOC 1 — Auth (S23)

```
FICHIER SOURCE : auth_routes.py (139 lignes)
DÉPENDANCES : JWT (HS256), bcrypt, Google OAuth, table users
POINTS CRITIQUES :
- JWT claim = "user_id" (PAS "sub") — vérifier la compat avec le front
- Cookie fallback "winek_token" — doit être supporté
- Google OAuth : flow serveur → vérifier id_token Google → upsert user
- bcrypt : même salt rounds que Python (par défaut 12)
- register retourne le user complet (RETURNING *)
PIÈGE : Le front stocke le token et le renvoie en header Authorization: Bearer xxx
        ET en cookie winek_token. Les deux doivent fonctionner.
```

### BLOC 2 — Home + TagPoints read (S26–S28)

```
FICHIER SOURCE : home_routes.py (250 lignes), tagpoint_routes.py (2100+ lignes)
DÉPENDANCES : PostGIS (ST_DWithin, ST_DistanceSphere, ST_MakePoint), table tag_points
POINTS CRITIQUES :
- PostGIS est OBLIGATOIRE. Installer l'extension PostgreSQL.
- home/feed : requête complexe avec filtres géo, visibility, active
- tag-points/{id} : 15+ sous-requêtes (members, votes, images, services, etc.)
- _mask_address() regex pour masquer les adresses (privacy)
- NextSessionDateCalculator avec fuseau Europe/Paris
PIÈGE : Le feed calcule `is_member`, `is_saved`, `is_going` pour chaque item
        → sous-requêtes corrélées. Optimiser avec des JOINs si possible.
```

### BLOC 3 — SpotYou write (S29–S31)

```
FICHIER SOURCE : tagpoint_routes.py (lignes 654–2100)
DÉPENDANCES : spot_you_members, spot_you_votes, notifications, push_service
POINTS CRITIQUES :
- join : 3 modes (open → direct, admin_approval → pending, members_approval → pending + notif)
- approve/reject : HTTP 409 si déjà traité (concurrence)
- invite : check permissions (admin_only, admin_and_members), push notification
- SpotYou private → POST /join retourne 403
- ON CONFLICT DO UPDATE pour re-candidature après rejet
PIÈGE : Les notifications push sont fire-and-forget (asyncio.create_task en Python).
        En Java : @Async ou CompletableFuture.
```

### BLOC 4 — Services + Booking (S32–S33)

```
FICHIER SOURCE : service_routes.py (1150 lignes), booking_routes.py (lignes 115–383, 558–670)
DÉPENDANCES : pricing_engine.py, service_slots, service_locations, service_packages
POINTS CRITIQUES :
- POST /services : validation complexe (slots, packages, locations, images)
- POST /bookings/request : 220 lignes, 4 flux (instant/manual × pay_now/pay_later),
  row-level lock NOWAIT, pricing engine, idempotence clé + slot×user
- POST /bookings/{id}/pay : crée Checkout Session Stripe, idempotence session existante
- pricing_engine.py : module indépendant, calcule frais avec subscription benefits
PIÈGE : Le pricing engine est la SEULE source de vérité pour les montants.
        Ne JAMAIS recalculer les prix dans le controller.
```

### BLOC 5 — Chat + WebSocket (S34–S35)

```
FICHIER SOURCE : chat_routes.py (700 lignes)
DÉPENDANCES : WebSocket (asyncio en Python → Spring WebSocket / STOMP en Java)
POINTS CRITIQUES :
- 3 WebSocket endpoints : chat, notifications, spot-you live
- ws/chat : auth via query param token, messages en temps réel, typing indicators
- ws/notifications : broadcast notifications push en temps réel
- ws/spot-you : mises à jour live des participants/going
- Messages stockés en DB (table messages)
- context_deleted flag pour les conversations quittées
PIÈGE : Python utilise asyncio WebSocket natif. Java peut utiliser :
  a) Spring WebSocket + STOMP (recommandé pour scaling)
  b) Spring WebSocket raw (plus proche du Python)
  Le protocole client doit rester compatible avec le front existant.
```

---

## Règles transversales pour TOUS les blocs

### 1. Réponses JSON en snake_case

```java
// application.yml
spring:
  jackson:
    property-naming-strategy: SNAKE_CASE
```

Ou `@JsonProperty("snake_case")` sur chaque champ. Le front attend du snake_case.

### 2. Erreurs HTTP compatibles

```python
# Python
raise HTTPException(status_code=404, detail="Réservation introuvable")
# → JSON: {"detail": "Réservation introuvable"}

# Java
throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Réservation introuvable");
# → Configurer pour retourner {"detail": "..."} et non {"message": "..."}
```

### 3. Dates en ISO 8601 avec timezone

```
Python : datetime.now(timezone.utc) → "2026-04-13T12:00:00+00:00"
Java   : OffsetDateTime.now(ZoneOffset.UTC) → "2026-04-13T12:00:00Z"
```

Les deux formats sont compatibles. Le `Z` et `+00:00` sont équivalents en ISO 8601.

### 4. ID generation

```python
# Python : models.py
def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"
```

```java
// Java
@Component
public class IdGenerator {
    public String generate(String prefix) {
        return prefix + "_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }
}
```

### 5. ObjectId / _id — NON APPLICABLE

Ce projet utilise PostgreSQL (pas MongoDB). Pas de problème ObjectId.
Les PK sont des strings générées côté application (format `prefix_12hexchars`).

### 6. CORS

```java
// Autoriser le domaine frontend (pas wildcard en prod)
@Configuration
public class CorsConfig implements WebMvcConfigurer {
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOriginPatterns("*")  // dev
            .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
            .allowCredentials(true);
    }
}
```

**Référence** : `STABILIZATION_CORS.md` (déjà créé dans les docs de stabilisation).

---

## Ordre des slices Cursor (résumé exécutif)

```
S23: Auth (register, login, google, logout, change-password)
S24: User profile write (PUT profile, become-coach, cover, search)
S25: Upload + Push tokens
S26: Home feed (nearest-sector + feed)
S27: TagPoints reads (list, mine, saved, detail, similar, participants)
S28: Notifications + planning (notifications, read, events, planning)
S29: TagPoints CRUD (create, update, new-date, save/unsave)
S30: TagPoints join/invite/approve (join, cancel, leave, invite, accept/refuse, approve/reject)
S31: TagPoints vote + SpotYou routes (vote, spot-you join/leave/going/activity)
S32: Services CRUD (create, update, delete, mine, saved, deactivated, reactivate)
S33: Booking create + pay (request, pay, price-preview)
S34: Chat HTTP (conversations CRUD, messages, read)
S35: WebSocket (chat, notifications, spot-you)

→ CUTOVER POSSIBLE ICI (front user complet)

S36–S46: Compléments + Admin (post-cutover)
```
