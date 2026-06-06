package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.service.JwtService;
import com.spotu.modules.chat.service.ChatPushService;
import com.spotu.modules.chat.service.ChatService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

@Component
public class ChatWsHandler extends TextWebSocketHandler {
    private static final Logger log = LoggerFactory.getLogger(ChatWsHandler.class);
    private static final int MAX_BYTES = 8192;
    private static final long MIN_INTERVAL_MS = 500;
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();

    private final ObjectMapper objectMapper;
    private final JwtService jwtService;
    private final ChatService chatService;
    private final ChatPushService chatPushService;
    private final WsConnectionRegistry chatRegistry;

    public ChatWsHandler(
            ObjectMapper objectMapper,
            JwtService jwtService,
            ChatService chatService,
            ChatPushService chatPushService,
            @Qualifier("chatRegistry") WsConnectionRegistry chatRegistry
    ) {
        this.objectMapper = objectMapper;
        this.jwtService = jwtService;
        this.chatService = chatService;
        this.chatPushService = chatPushService;
        this.chatRegistry = chatRegistry;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String convId = extractLastPathSegment(session.getUri());
        session.getAttributes().put("conv_id", convId);
        session.getAttributes().put("authenticated", false);
        session.getAttributes().put("last_msg_ms", new AtomicLong(0L));
        SCHEDULER.schedule(() -> {
            try {
                Object auth = session.getAttributes().get("authenticated");
                if (session.isOpen() && !(auth instanceof Boolean b && b)) {
                    session.close(WsCloseCodes.AUTH_FAIL);
                }
            } catch (Exception ignored) {
            }
        }, 5, TimeUnit.SECONDS);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        if (!isAuthenticated(session)) {
            authenticate(session, message);
            return;
        }
        JsonNode node;
        try {
            node = objectMapper.readTree(message.getPayload());
        } catch (Exception ignored) {
            return;
        }
        String content = node.path("content").asText("");
        content = content == null ? "" : content.trim();
        if (content.isBlank()) {
            return;
        }
        Boolean contextDeleted = (Boolean) session.getAttributes().get("context_deleted");
        if (Boolean.TRUE.equals(contextDeleted)) {
            sendJson(session, Map.of(
                    "type", "error",
                    "code", "CONTEXT_DELETED",
                    "message", "Ce contexte a été supprimé. La conversation est en lecture seule."
            ));
            return;
        }
        if (content.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            session.close(WsCloseCodes.MESSAGE_TOO_LARGE);
            return;
        }
        AtomicLong lastMs = (AtomicLong) session.getAttributes().get("last_msg_ms");
        long nowMs = System.currentTimeMillis();
        if (nowMs - lastMs.get() < MIN_INTERVAL_MS) {
            return;
        }
        lastMs.set(nowMs);

        String convId = (String) session.getAttributes().get("conv_id");
        String userId = (String) session.getAttributes().get("user_id");
        String name = (String) session.getAttributes().get("user_name");
        String picture = (String) session.getAttributes().get("user_picture");
        final String finalContent = content;
        Map<String, Object> payload = chatService.persistWsMessage(convId, userId, name, picture, finalContent);
        chatRegistry.broadcast(convId, payload);

        for (String pid : chatService.otherActiveParticipants(convId, userId)) {
            chatService.pushUnread(pid);
            CompletableFuture.runAsync(() -> chatPushService.sendToUser(
                    pid,
                    name,
                    finalContent.substring(0, Math.min(100, finalContent.length())),
                    Map.of("type", "chat_message", "conversationId", convId),
                    false
            ));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String convId = (String) session.getAttributes().get("conv_id");
        if (convId != null) {
            chatRegistry.disconnect(convId, session);
        }
    }

    private void authenticate(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode node;
        try {
            node = objectMapper.readTree(message.getPayload());
        } catch (Exception ex) {
            session.close(WsCloseCodes.AUTH_FAIL);
            return;
        }
        String token = node.path("token").asText("");
        if (token.isBlank()) {
            session.close(WsCloseCodes.AUTH_FAIL);
            return;
        }
        final Map<String, Object> claims;
        try {
            claims = jwtService.decodePayload(token);
        } catch (Exception ex) {
            session.close(WsCloseCodes.AUTH_FAIL);
            return;
        }
        String userId = claims.get("user_id") == null ? null : String.valueOf(claims.get("user_id"));
        if (userId == null || userId.isBlank()) {
            session.close(WsCloseCodes.AUTH_FAIL);
            return;
        }
        String convId = (String) session.getAttributes().get("conv_id");
        if (!chatService.isActiveParticipant(convId, userId)) {
            session.close(WsCloseCodes.PERMISSION_DENIED);
            return;
        }
        Map<String, Object> user = chatService.findUserSummary(userId).orElseGet(() -> {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("name", "");
            m.put("picture", "");
            return m;
        });
        session.getAttributes().put("user_id", userId);
        session.getAttributes().put("user_name", user.get("name") == null ? "" : String.valueOf(user.get("name")));
        session.getAttributes().put("user_picture", user.get("picture") == null ? "" : String.valueOf(user.get("picture")));
        session.getAttributes().put("context_deleted", chatService.isContextDeleted(convId));
        session.getAttributes().put("authenticated", true);
        chatRegistry.add(convId, session);
        sendJson(session, Map.of("type", "auth_ok"));
    }

    private boolean isAuthenticated(WebSocketSession session) {
        Object v = session.getAttributes().get("authenticated");
        return v instanceof Boolean b && b;
    }

    private void sendJson(WebSocketSession session, Map<String, Object> payload) {
        try {
            synchronized (session) {
                if (session.isOpen()) {
                    session.sendMessage(new TextMessage(objectMapper.writeValueAsString(payload)));
                }
            }
        } catch (Exception ex) {
            log.warn("ws send failed", ex);
        }
    }

    private static String extractLastPathSegment(URI uri) {
        if (uri == null) return null;
        String p = uri.getPath();
        if (p == null || p.isBlank()) return null;
        int idx = p.lastIndexOf('/');
        return idx >= 0 ? p.substring(idx + 1) : p;
    }
}
