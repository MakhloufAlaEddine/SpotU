# SLICE 48 — Cursor Implementation Notes (Chat & WebSockets)

> **Cible** : Java 17 + Spring Boot 3.x + PostgreSQL (HikariCP via JdbcTemplate **OU** R2DBC, au choix).
> **Convention** : préserver iso Python — pas de "modernisation". L'objectif est de pouvoir basculer le front sans changer un seul appel.
> **Source** : `chat_routes.py:1–715` + `chat_manager.py:1–89` + `deletion_routes.py:436–517`.

---

## 1. Stack & dépendances

### 1.1. Maven / Gradle

```xml
<dependencies>
    <!-- Web -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <!-- WebSocket — JSR-356 ou Spring WebSocket -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-websocket</artifactId>
    </dependency>
    <!-- DB -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-jdbc</artifactId>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
    </dependency>
    <!-- Security / JWT (existant slices précédentes) -->
    <dependency>
        <groupId>io.jsonwebtoken</groupId>
        <artifactId>jjwt-api</artifactId>
    </dependency>
    <!-- JSON -->
    <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
    </dependency>
</dependencies>
```

### 1.2. Pas de Spring STOMP ni Sockjs
- Le protocole Python utilise des **frames JSON brutes** (pas STOMP).
- Configuration recommandée : `WebSocketConfigurer` low-level avec `WebSocketHandler` (sans `@MessageMapping`).

```java
@Configuration
@EnableWebSocket
public class ChatWebSocketConfig implements WebSocketConfigurer {
    private final ChatWsHandler chatHandler;
    private final NotifWsHandler notifHandler;
    private final SpotYouWsHandler spotyouHandler;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry
          .addHandler(chatHandler,    "/api/ws/chat/{convId}")
          .addHandler(notifHandler,   "/api/ws/notifications")
          .addHandler(spotyouHandler, "/api/ws/spot-you/{pointId}")
          .setAllowedOriginPatterns("*");
        // PAS de .withSockJS() — on veut un WebSocket pur.
    }
}
```

### 1.3. Prefix `/api`
- Les 3 endpoints WS sont sous `/api` (cf. `server.py:93` — `api_router = APIRouter(prefix="/api")`).
- Le router chat n'a pas de sous-prefix → chemins absolus = `/api/ws/chat/...`, `/api/ws/notifications`, `/api/ws/spot-you/...`.

---

## 2. Connection registry (équivalent `chat_manager.py`)

```java
@Component
public class ConnectionRegistry {
    private static final Logger log = LoggerFactory.getLogger(ConnectionRegistry.class);
    // CopyOnWriteArrayList pour iter sûr pendant une mutation
    private final Map<String, List<WebSocketSession>> active = new ConcurrentHashMap<>();

    public void add(String key, WebSocketSession ws) {
        active.computeIfAbsent(key, k -> new CopyOnWriteArrayList<>()).add(ws);
    }

    public void disconnect(String key, WebSocketSession ws) {
        List<WebSocketSession> sessions = active.get(key);
        if (sessions != null) {
            sessions.removeIf(s -> s == ws);  // identité, pas equals (BR-48.63)
        }
    }

    public void broadcast(String key, Object payload) {
        List<WebSocketSession> sessions = active.get(key);
        if (sessions == null) return;
        String json = ChatJsonMapper.toJson(payload);
        TextMessage msg = new TextMessage(json);
        List<WebSocketSession> dead = new ArrayList<>();
        for (WebSocketSession ws : sessions) {
            try {
                synchronized (ws) {  // session.sendMessage n'est PAS thread-safe
                    if (ws.isOpen()) ws.sendMessage(msg);
                }
            } catch (Exception e) {
                log.warn("[WS] broadcast: connexion morte (key={}) — {}", key, e.toString());
                dead.add(ws);
            }
        }
        dead.forEach(d -> disconnect(key, d));
    }
}
```

> ⚠️ **3 instances distinctes** :
> - `chatRegistry` (clé = `convId`) — utilisée par WS chat + DELETE message broadcast
> - `notifRegistry` (clé = `userId`) — utilisée par WS notifications
> - `spotyouRegistry` (clé = `pointId`) — utilisée par WS spot-you
>
> Définir 3 beans `@Qualifier`-typés ou 3 sous-classes triviales :

```java
@Component public class ChatRegistry    extends ConnectionRegistry {}
@Component public class NotifRegistry   extends ConnectionRegistry {}
@Component public class SpotYouRegistry extends ConnectionRegistry {}
```

---

## 3. WS handshake générique (utilitaire)

```java
public class WsAuthHelper {
    public static String authenticateOrClose(WebSocketSession ws,
                                             ObjectMapper objectMapper,
                                             JwtService jwtService,
                                             Logger logger,
                                             String contextLabel)
            throws IOException, InterruptedException {
        // 1. Attendre le premier frame JSON {"token": "..."} dans 5s
        TextMessage authMsg;
        try {
            authMsg = ws.getAttributes().containsKey("__firstFrame")
                ? (TextMessage) ws.getAttributes().get("__firstFrame")
                : pollFirstFrame(ws, Duration.ofSeconds(5));
        } catch (TimeoutException te) {
            logger.warn("[{}] Timeout handshake", contextLabel);
            ws.close(new CloseStatus(4001, "AUTH_TIMEOUT"));
            return null;
        } catch (Exception e) {
            logger.warn("[{}] Erreur handshake: {}", contextLabel, e.toString());
            ws.close(new CloseStatus(4001, "AUTH_ERROR"));
            return null;
        }

        // 2. Parser
        String token;
        try {
            JsonNode node = objectMapper.readTree(authMsg.getPayload());
            token = node.path("token").asText("");
            if (token.isEmpty()) throw new IllegalArgumentException("missing token");
        } catch (Exception e) {
            ws.close(new CloseStatus(4001, "AUTH_PARSE"));
            return null;
        }

        // 3. Décoder JWT
        Claims claims;
        try {
            claims = jwtService.decode(token);
        } catch (Exception e) {
            ws.close(new CloseStatus(4001, "AUTH_INVALID"));
            return null;
        }
        String userId = claims.get("user_id", String.class);
        if (userId == null) {
            ws.close(new CloseStatus(4001, "AUTH_NO_USER"));
            return null;
        }
        return userId;
    }
}
```

> ⚠️ Spring WebSocket ne fournit PAS de `receive_json` synchrone avec timeout. Implémentation :
> - Méthode 1 : `BlockingQueue<TextMessage>` alimentée par `handleTextMessage`, polled depuis `afterConnectionEstablished`.
> - Méthode 2 : `CompletableFuture<TextMessage>` resolved dans `handleTextMessage`, `.get(5, TimeUnit.SECONDS)`.
>
> Voir §5 pour le pattern complet.

### Codes de close (BR-48.40)
```java
public final class WsCloseCodes {
    public static final CloseStatus AUTH_FAIL          = new CloseStatus(4001);
    public static final CloseStatus PERMISSION_DENIED  = new CloseStatus(4003);
    public static final CloseStatus MESSAGE_TOO_LARGE  = new CloseStatus(4009);
    private WsCloseCodes() {}
}
```

---

## 4. WS chat handler

```java
@Component
public class ChatWsHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(ChatWsHandler.class);
    private static final long  MSG_MIN_INTERVAL_NS = 500_000_000L; // 500 ms
    private static final int   MSG_MAX_BYTES       = 8192;

    private final ChatRegistry          chatRegistry;
    private final NotifRegistry         notifRegistry;
    private final ConversationService   convService;     // SQL
    private final MessageService        msgService;      // SQL
    private final UserLookupService     userLookup;
    private final PushService           pushService;     // stub no-op pendant S48
    private final ObjectMapper          objectMapper;
    private final JwtService            jwtService;

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) throws Exception {
        // 0. Extraire convId depuis URI — Spring path matcher
        String convId = (String) ws.getAttributes().get("convId");
        if (convId == null) {
            convId = extractPathVar(ws.getUri(), "convId");
            ws.getAttributes().put("convId", convId);
        }

        // 1. Auth via premier frame
        String userId = WsAuthHelper.authenticateOrClose(ws, objectMapper, jwtService, log, "WS chat (conv=" + convId + ")");
        if (userId == null) return;

        // 2. Vérification membership ACTIF
        if (!convService.isActiveParticipant(convId, userId)) {
            log.warn("[WS chat] Accès refusé (user={}, conv={})", userId, convId);
            ws.close(WsCloseCodes.PERMISSION_DENIED);
            return;
        }

        // 3. Charger user info + context_deleted (cache local)
        UserSummary user = userLookup.findById(userId);
        boolean contextDeleted = convService.isContextDeleted(convId);
        ws.getAttributes().put("userInfo", user);
        ws.getAttributes().put("contextDeleted", contextDeleted);
        ws.getAttributes().put("lastMsgNanos", new AtomicLong(0L));

        chatRegistry.add(convId, ws);
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage frame) throws Exception {
        // Ignore si pas encore authentifié (premier frame consommé par auth helper, sinon erreur)
        UserSummary user = (UserSummary) ws.getAttributes().get("userInfo");
        if (user == null) return;  // (auth helper a fait close)

        String convId          = (String) ws.getAttributes().get("convId");
        boolean contextDeleted = (boolean) ws.getAttributes().get("contextDeleted");
        AtomicLong lastNanos   = (AtomicLong) ws.getAttributes().get("lastMsgNanos");

        JsonNode node;
        try {
            node = objectMapper.readTree(frame.getPayload());
        } catch (Exception e) { return; /* iso Python : silent skip */ }

        String content = node.path("content").asText("").strip();
        if (content.isEmpty()) return;  // BR-48.43

        // BR-48.44 — context_deleted
        if (contextDeleted) {
            sendErrorFrame(ws, "CONTEXT_DELETED",
                "Ce contexte a été supprimé. La conversation est en lecture seule.");
            return;
        }

        // BR-48.45 — taille (UTF-8 octets)
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MSG_MAX_BYTES) {
            log.warn("[WS chat] Message trop grand (user={}, conv={}, size={})",
                user.userId(), convId, bytes.length);
            ws.close(WsCloseCodes.MESSAGE_TOO_LARGE);
            return;
        }

        // BR-48.46 — anti-spam 500 ms (silent)
        long now = System.nanoTime();
        if (now - lastNanos.get() < MSG_MIN_INTERVAL_NS) return;
        lastNanos.set(now);

        // BR-48.47 — INSERT + UPDATE
        String msgId = "msg_" + UUID.randomUUID().toString().replace("-","").substring(0,12);
        OffsetDateTime ts = OffsetDateTime.now(ZoneOffset.UTC);
        msgService.insertMessage(msgId, convId, user.userId(), content, ts);
        convService.updateLastMessageAt(convId, ts);

        // BR-48.48 — broadcast
        Map<String, Object> payload = Map.of(
            "message_id", msgId,
            "conversation_id", convId,
            "sender_id", user.userId(),
            "sender_name", user.name(),
            "sender_picture", user.picture(),  // peut être null
            "content", content,
            "created_at", ts.toString()
        );
        chatRegistry.broadcast(convId, payload);

        // BR-48.50 — push unread_total aux autres ACTIFS
        List<String> others = convService.findOtherActiveParticipants(convId, user.userId());
        for (String pid : others) {
            int unread = msgService.countUnreadTotal(pid);
            notifRegistry.broadcast(pid, Map.of("type","unread_total","count", unread));
        }

        // BR-48.51 — push fire-and-forget
        for (String pid : others) {
            CompletableFuture.runAsync(() -> pushService.sendToUser(
                pid,
                user.name(),
                content.length() > 100 ? content.substring(0, 100) : content,
                Map.of("type","chat_message","conversationId", convId),
                /*store=*/ false
            ));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        String convId = (String) ws.getAttributes().get("convId");
        if (convId != null) chatRegistry.disconnect(convId, ws);
    }

    private void sendErrorFrame(WebSocketSession ws, String code, String message) throws IOException {
        synchronized (ws) {
            if (ws.isOpen()) {
                ws.sendMessage(new TextMessage(objectMapper.writeValueAsString(Map.of(
                    "type", "error", "code", code, "message", message
                ))));
            }
        }
    }
}
```

> ⚠️ **L'auth helper consomme le premier frame**. Le pattern recommandé :
> - Dans `afterConnectionEstablished`, lancer un thread/CompletableFuture qui attend 5 s sur le premier frame.
> - `handleTextMessage` détecte si la session est déjà authentifiée (via `ws.getAttributes().get("userInfo") != null`). Si pas encore, il alimente la queue d'auth.

---

## 5. Pattern alternatif : Spring WebSocket + Future pour handshake

```java
public class HandshakeBuffer {
    private final BlockingQueue<TextMessage> queue = new LinkedBlockingQueue<>();
    private volatile boolean authenticated = false;

    public void offer(TextMessage msg) { queue.offer(msg); }
    public TextMessage await(Duration timeout) throws InterruptedException, TimeoutException {
        TextMessage m = queue.poll(timeout.toMillis(), TimeUnit.MILLISECONDS);
        if (m == null) throw new TimeoutException();
        return m;
    }
    public void markAuthenticated() { this.authenticated = true; }
    public boolean isAuthenticated() { return authenticated; }
}
```

```java
@Override
public void afterConnectionEstablished(WebSocketSession ws) throws Exception {
    HandshakeBuffer buffer = new HandshakeBuffer();
    ws.getAttributes().put("handshakeBuffer", buffer);
    // Lance un task async qui consomme le 1er frame
    CompletableFuture.runAsync(() -> doAuth(ws, buffer));
}

@Override
protected void handleTextMessage(WebSocketSession ws, TextMessage frame) throws Exception {
    HandshakeBuffer buffer = (HandshakeBuffer) ws.getAttributes().get("handshakeBuffer");
    if (!buffer.isAuthenticated()) {
        buffer.offer(frame);
        return;  // le frame d'auth est délégué au task async
    }
    handleAuthenticatedMessage(ws, frame);
}

private void doAuth(WebSocketSession ws, HandshakeBuffer buffer) {
    try {
        TextMessage authFrame = buffer.await(Duration.ofSeconds(5));
        String userId = parseAndValidateToken(authFrame, ws);
        if (userId == null) return;
        // … vérif membership, init state, registry.add …
        buffer.markAuthenticated();
    } catch (TimeoutException e) {
        ws.close(WsCloseCodes.AUTH_FAIL);
    } catch (Exception e) {
        log.warn("Auth error", e); ws.close(WsCloseCodes.AUTH_FAIL);
    }
}
```

---

## 6. WS notifications handler

```java
@Component
public class NotifWsHandler extends TextWebSocketHandler {
    private final NotifRegistry      notifRegistry;
    private final MessageService     msgService;
    private final NotificationService notifService;
    // … objectMapper, jwtService

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) throws Exception {
        String userId = WsAuthHelper.authenticateOrClose(ws, objectMapper, jwtService, log, "WS notif");
        if (userId == null) return;

        notifRegistry.add(userId, ws);
        ws.getAttributes().put("userId", userId);

        // BR-48.54 — frames d'init
        int unreadTotal = msgService.countUnreadTotal(userId);
        int unreadNotif = notifService.countUnread(userId);
        send(ws, Map.of("type", "unread_total", "count", unreadTotal));
        send(ws, Map.of("type", "unread_notif", "count", unreadNotif));
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage message) {
        // BR-48.55 — frames clients ignorées (keep-alive)
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        String uid = (String) ws.getAttributes().get("userId");
        if (uid != null) notifRegistry.disconnect(uid, ws);
    }
}
```

---

## 7. WS spot-you handler

```java
@Component
public class SpotYouWsHandler extends TextWebSocketHandler {
    private final SpotYouRegistry spotyouRegistry;
    // …

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) throws Exception {
        String userId = WsAuthHelper.authenticateOrClose(ws, objectMapper, jwtService, log, "WS spotyou");
        if (userId == null) return;

        // BR-48.57 — pas de check membership
        String pointId = extractPathVar(ws.getUri(), "pointId");
        spotyouRegistry.add(pointId, ws);
        ws.getAttributes().put("pointId", pointId);
        log.info("[WS spotyou] Connecté (user={}, point={})", userId, pointId);
        // BR-48.58 — AUCUN frame d'init
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage frame) {
        // BR-48.59 — keep-alive, ignoré
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        String pid = (String) ws.getAttributes().get("pointId");
        if (pid != null) spotyouRegistry.disconnect(pid, ws);
    }
}
```

---

## 8. Controllers HTTP

### 8.1. ConversationController

```java
@RestController
@RequestMapping("/api")
public class ConversationController {
    private final ConversationService convService;
    private final MessageService      msgService;
    private final NotifRegistry       notifRegistry;

    @PostMapping("/conversations")
    public ResponseEntity<Map<String, Object>> create(
            @AuthenticationPrincipal AuthUser caller,
            @Valid @RequestBody ConversationCreateDto dto) {
        if (!Set.of("service","tagpoint_group","tagpoint_private").contains(dto.type())) {
            throw new InvalidConversationTypeException();  // → 400 detail
        }
        String convId = convService.createOrGet(caller.userId(), dto.type(), dto.contextId());
        return ResponseEntity.ok(convService.getMetadata(convId));
    }

    @GetMapping("/conversations")
    public List<Map<String, Object>> list(@AuthenticationPrincipal AuthUser caller) {
        return convService.listEnriched(caller.userId());
    }

    @GetMapping("/conversations/{convId}/messages")
    public List<Map<String, Object>> messages(
            @PathVariable String convId,
            @AuthenticationPrincipal AuthUser caller,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) String before) {
        if (!convService.isAnyParticipant(convId, caller.userId()))
            throw new NotParticipantException();  // 403

        List<Map<String,Object>> list = msgService.fetchMessages(convId, limit, before);
        Collections.reverse(list);  // BR-48.21

        // Side effects (BR-48.23, BR-48.24)
        convService.markRead(convId, caller.userId());
        int unread = msgService.countUnreadTotal(caller.userId());
        notifRegistry.broadcast(caller.userId(), Map.of("type","unread_total","count",unread));
        return list;
    }

    @PutMapping("/conversations/{convId}/read")
    public Map<String, Object> markRead(
            @PathVariable String convId,
            @AuthenticationPrincipal AuthUser caller) {
        convService.markRead(convId, caller.userId());
        int unread = msgService.countUnreadTotal(caller.userId());
        notifRegistry.broadcast(caller.userId(), Map.of("type","unread_total","count",unread));
        return Map.of("success", true);
    }
}
```

### 8.2. DeletionController (extension partielle)

```java
@RestController
@RequestMapping("/api")
public class DeletionController {  // existant — étendre

    @DeleteMapping("/messages/{messageId}")
    public Map<String,Object> deleteMessage(
            @PathVariable String messageId,
            @AuthenticationPrincipal AuthUser caller) {

        Message msg = msgService.findById(messageId);
        if (msg == null) throw new MessageNotFoundException();   // 404
        if (msg.deletedAt() != null) {                            // BR-48.27 ordre
            return Map.of("success", true, "already_deleted", true);
        }
        boolean isAdmin = "admin".equals(caller.role());
        if (!msg.senderId().equals(caller.userId()) && !isAdmin) {
            throw new ForbiddenDeletionException();              // 403
        }

        msgService.softDelete(messageId);
        chatRegistry.broadcast(msg.conversationId(), Map.of(
            "type","message_deleted",
            "message_id", messageId,
            "conversation_id", msg.conversationId()
        ));
        return Map.of("success", true, "deleted", true, "message_id", messageId);
    }

    @PatchMapping("/conversations/{convId}/leave")
    public Map<String,Object> leave(
            @PathVariable String convId,
            @AuthenticationPrincipal AuthUser caller) {
        Optional<String> currentStatus = convService.findParticipantStatus(convId, caller.userId());
        if (currentStatus.isEmpty()) throw new NotParticipantException(); // 404 (DIFFERENT du 403 GET messages — voir §10)
        if ("left".equals(currentStatus.get())) {
            return Map.of("success", true, "already_left", true);
        }
        convService.markLeft(convId, caller.userId());
        if (convService.countActiveParticipants(convId) == 0) {
            convService.softDelete(convId);
        }
        return Map.of("success", true, "left", true, "conversation_id", convId);
    }
}
```

---

## 9. Service layer — `_batch_enrich_conversations` (CRITIQUE perf)

```java
@Service
public class ConversationService {
    private final NamedParameterJdbcTemplate jdbc;

    public List<Map<String,Object>> listEnriched(String callerId) {
        // 1. Liste brute
        List<Map<String,Object>> convs = jdbc.queryForList(SQL_LIST_BASE,
            new MapSqlParameterSource("uid", callerId));
        if (convs.isEmpty()) return convs;

        List<String> convIds   = convs.stream().map(c -> (String)c.get("conversation_id")).toList();
        List<String> groupIds  = convs.stream().filter(c -> "tagpoint_group".equals(c.get("type")))
                                              .map(c -> (String)c.get("conversation_id")).toList();
        List<String> privateIds= convs.stream().filter(c -> !"tagpoint_group".equals(c.get("type")))
                                              .map(c -> (String)c.get("conversation_id")).toList();
        List<String> groupCtx  = convs.stream().filter(c -> "tagpoint_group".equals(c.get("type")))
                                              .map(c -> (String)c.get("context_id")).toList();

        // 2. 5 queries parallèles
        CompletableFuture<List<Map<String,Object>>> lastMsgF = CompletableFuture.supplyAsync(() ->
            jdbc.queryForList(SQL_LAST_MESSAGES, params("ids", convIds)));
        CompletableFuture<List<Map<String,Object>>> unreadF = CompletableFuture.supplyAsync(() ->
            jdbc.queryForList(SQL_UNREAD_COUNTS, params("uid", callerId, "ids", convIds)));
        CompletableFuture<List<Map<String,Object>>> statusF = CompletableFuture.supplyAsync(() ->
            jdbc.queryForList(SQL_STATUSES, params("ids", convIds, "uid", callerId)));
        CompletableFuture<List<Map<String,Object>>> otherF = CompletableFuture.supplyAsync(() ->
            privateIds.isEmpty() ? List.of()
                : jdbc.queryForList(SQL_OTHER_PARTICIPANTS, params("ids", privateIds, "uid", callerId)));
        CompletableFuture<GroupData> groupF = CompletableFuture.supplyAsync(() -> {
            List<Map<String,Object>> counts = groupIds.isEmpty() ? List.of()
                : jdbc.queryForList(SQL_GROUP_COUNTS, params("ids", groupIds));
            List<Map<String,Object>> images = groupCtx.isEmpty() ? List.of()
                : jdbc.queryForList(SQL_GROUP_IMAGES, params("ids", groupCtx));
            return new GroupData(counts, images);
        });
        CompletableFuture.allOf(lastMsgF, unreadF, statusF, otherF, groupF).join();

        // 3. Maps lookup O(1)
        Map<String,Map<String,Object>> lastMsgMap = lastMsgF.get().stream()
            .collect(Collectors.toMap(r -> (String)r.get("conversation_id"), r -> r));
        Map<String,Integer> unreadMap = unreadF.get().stream()
            .collect(Collectors.toMap(r -> (String)r.get("conversation_id"),
                                       r -> ((Number)r.get("unread_count")).intValue()));
        Map<String,String>  statusMap = statusF.get().stream()
            .collect(Collectors.toMap(r -> (String)r.get("conversation_id"),
                                       r -> (String)r.get("status")));
        Map<String,List<Map<String,Object>>> otherByConv = otherF.get().stream()
            .collect(Collectors.groupingBy(r -> (String)r.get("conversation_id")));
        Map<String,Integer> grpCntMap = groupF.get().counts().stream()
            .collect(Collectors.toMap(r -> (String)r.get("conversation_id"),
                                       r -> ((Number)r.get("cnt")).intValue()));
        Map<String,String> ctxImgMap = groupF.get().images().stream()
            .collect(Collectors.toMap(
                r -> (String)r.get("point_id"),
                r -> firstImage(r.get("images")),
                (a,b) -> a));

        // 4. Assemble
        for (Map<String,Object> c : convs) {
            String cid = (String) c.get("conversation_id");
            Map<String,Object> msg = lastMsgMap.get(cid);
            if (msg != null) {
                msg = new HashMap<>(msg);
                msg.remove("conversation_id");
            }
            c.put("last_message", msg);
            c.put("unread_count", unreadMap.getOrDefault(cid, 0));
            c.put("is_blocked", "blocked".equals(statusMap.get(cid)));
            if (!"tagpoint_group".equals(c.get("type"))) {
                List<Map<String,Object>> others = otherByConv.getOrDefault(cid, List.of());
                c.put("other_participant", others.isEmpty() ? null : others.get(0));
            } else {
                c.put("participant_count", grpCntMap.getOrDefault(cid, 0));
                c.put("other_participant", null);
                c.put("context_image", ctxImgMap.get(c.get("context_id")));
            }
        }
        return convs;
    }

    private String firstImage(Object raw) {
        if (raw == null) return null;
        try {
            JsonNode arr = raw instanceof PGobject p
                ? mapper.readTree(p.getValue())
                : raw instanceof String s ? mapper.readTree(s)
                : mapper.valueToTree(raw);
            return arr.isArray() && arr.size() > 0 ? arr.get(0).asText(null) : null;
        } catch (Exception e) { return null; }
    }
}
```

---

## 10. Pièges identifiés & comment les éviter

| # | Piège | Mitigation |
|---|-------|------------|
| 1 | **Spring STOMP attendu**, mais Python utilise frames JSON brutes | Ne PAS utiliser `@MessageMapping`, utiliser `WebSocketHandler` low-level. |
| 2 | Spring `accept` automatique au handshake HTTP, alors que Python attend le token APRÈS accept | Spring fait pareil : `afterConnectionEstablished` est appelé après `accept` HTTP. ✅ Iso. Mais : la lecture du **premier frame** (auth) est asynchrone — voir pattern §5. |
| 3 | `session.sendMessage()` n'est PAS thread-safe | Wrapper avec `synchronized(ws) { … }` dans `ConnectionRegistry.broadcast`. |
| 4 | `removeIf(s -> s == ws)` (identité) vs `s.equals(ws)` | Utiliser `==` strict (BR-48.63). |
| 5 | Codes de close `4001/4003/4009` **doivent être exacts** (le front teste dessus) | Définir `WsCloseCodes` constants. Ne jamais utiliser 1008 / 1009 / 1011 par défaut. |
| 6 | `len(content.encode("utf-8"))` mesure des **octets**, pas des chars | `content.getBytes(StandardCharsets.UTF_8).length`. |
| 7 | Anti-spam **silent skip** (pas close) sur fréquence | `return;` (pas close). Documenter dans le test. |
| 8 | **Anti-spam compteur n'avance PAS sur skip vide ni context_deleted** | Ne mettre à jour `lastNanos` qu'**après** les checks (juste avant l'INSERT). |
| 9 | `ON CONFLICT DO UPDATE` pour group conv : ré-active un user `'blocked'` ou `'left'` | Préserver — sémantique voulue (rejoindre le groupe ré-active automatiquement). |
| 10 | Le code Python `tagpoint_private` et `service` insère SANS `status` (utilise DEFAULT DDL) | Idem en Java — INSERT sans la colonne `status`. Ne pas la rajouter. |
| 11 | `created_by` diffère entre group et private/service (BR-48.07) | Ne pas factoriser le code de création. |
| 12 | `firstImage()` parsing — `tag_points.images` est `jsonb` mais code Python a fallback `isinstance(str)` | Implémenter le fallback (PGobject jsonb + string + déjà-parsed list/json) — robuste face aux données legacy. |
| 13 | Side-effect mark-read **dans GET messages** | Ne PAS séparer dans une route distincte. La méthode `messages()` doit le faire (BR-48.23). |
| 14 | `_get_unread_total` est calculé **toutes convs confondues**, pas par conv | Bien faire la jointure batch sans filtre `WHERE conversation_id = …`. |
| 15 | Errors codes asymétriques HTTP : 403 `"Not a participant"` (GET messages) vs 404 `"Vous n'êtes pas participant…"` (PATCH leave) | Préserver l'asymétrie iso Python — le front peut tester sur le code (cf. BR-48.20 / BR-48.32). |
| 16 | `DELETE /messages/{id}` ordre des gardes : **404 → already_deleted (200) → 403** | Ne PAS swap les checks — l'ordre garantit que les messages déjà soft-deleted renvoient 200 même si demandé par non-auteur. |
| 17 | Push fire-and-forget `store=False` | NE PAS écrire dans `notifications`. Le paramètre `store` doit propager à `pushService`. |
| 18 | Cleanup `disconnect` **DANS finally**, JAMAIS dans le `catch` | Sinon : si l'exception remonte sans catch, leak garantie. |
| 19 | DELETE message broadcast émis **APRÈS** commit DB, pas avant | Si crash de la requête DB, pas de broadcast → cohérent avec Python (l'INSERT est exécuté avant le `manager.broadcast`). |
| 20 | Le check `is_admin` lit `caller.role()` — ne PAS faire de SELECT supplémentaire | Le rôle est dans le JWT (claim `role`) ou déjà chargé par le middleware d'auth. |
| 21 | WS spot-you n'a **AUCUN check membership** | Iso volontaire (BR-48.57). Ne PAS rajouter de validation par "défense en profondeur". |
| 22 | Pour `WS /ws/notifications`, l'init envoie 2 frames **dans cet ordre exact** (`unread_total` PUIS `unread_notif`) | Front compte sur l'ordre. Ne pas inverser. |
| 23 | **Pas de pub/sub multi-instance** (single-node Java requis) | Documenter dans le `application.yml` : `# WS-INSTANCE: must run as single instance until S48-bis Redis` |

---

## 11. Tests à automatiser

Voir `SLICE_48_TEST_CASES.md`. Recommandations runner :

- **Unit tests** : `ConversationService.listEnriched` mock JdbcTemplate.
- **Integration HTTP** : Spring Boot Test + TestContainer PostgreSQL + WebTestClient.
- **Integration WebSocket** : `org.springframework.web.socket.client.standard.StandardWebSocketClient` + `BlockingQueue<TextMessage>` côté test pour valider les frames.
- **Smoke test runtime** : le test E2E `/app/backend/tests/e2e/test_websockets.py` doit servir de référence comportementale (à reproduire en Java côté tests d'intégration — **NE PAS** porter le fichier Python en Java).

---

## 12. Critères de Done — checklist détaillée

- [ ] 6 endpoints HTTP exposés sur `/api/conversations/*` et `/api/messages/*` avec exactement les routes Python.
- [ ] 3 endpoints WebSocket exposés sur `/api/ws/chat/{convId}`, `/api/ws/notifications`, `/api/ws/spot-you/{pointId}`.
- [ ] Format de frames JSON identique (clés exactes, casse, valeurs nulles préservées) — comparé byte-à-byte avec Python.
- [ ] Codes de close `4001`, `4003`, `4009` émis aux bonnes occasions.
- [ ] Anti-spam 500 ms / message + max 8 KB UTF-8.
- [ ] Cleanup `disconnect` garanti dans tous les chemins de sortie WS.
- [ ] `_batch_enrich_conversations` avec 5 queries parallèles (benchmark < 500 ms pour 100 convs).
- [ ] `chatRegistry`, `notifRegistry`, `spotyouRegistry` en 3 beans distincts injectables ailleurs.
- [ ] Façade `pushService.sendToUser(...)` stub no-op pendant S48 (avec `store=false` propre).
- [ ] Tests d'intégration HTTP + WS verts (cf. `SLICE_48_TEST_CASES.md`).
- [ ] Aucun ajout de comportement (pas de typing, pas de presence, pas de read receipts par message, pas d'attachments).
- [ ] Documentation déploiement : single-instance only, sinon Redis pub/sub à introduire (slice future).

---

## 13. Ordre de migration recommandé pour Cursor

1. **HTTP-only first** :
   1. `POST /conversations` + `GET /conversations` (sans enrich complexe → vérifier les 3 types de conv).
   2. Ajouter `_batch_enrich_conversations` (5 queries // ).
   3. `GET /messages` + `PUT /read` + `_push_unread` stub (sans WS effectif).
   4. `DELETE /messages/{id}` + `PATCH /conversations/{id}/leave` (broadcast stub).
2. **WebSocket** :
   5. `ConnectionRegistry` + 3 beans typés.
   6. Pattern handshake JSON `{token}` 5 s + `WsAuthHelper` réutilisable.
   7. `ChatWsHandler` (anti-spam, taille, broadcast, push).
   8. `NotifWsHandler` (init frames + keep-alive).
   9. `SpotYouWsHandler` (keep-alive uniquement).
   10. Brancher `_push_unread` HTTP → `notifRegistry.broadcast(uid, ...)`.
3. **Branchement final** : façades publiques exposées pour les autres slices déjà mergées (notamment SpotYou writes pour `spotyouRegistry`).
