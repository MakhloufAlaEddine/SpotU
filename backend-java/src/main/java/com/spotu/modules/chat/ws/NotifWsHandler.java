package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.service.JwtService;
import com.spotu.modules.chat.service.ChatService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Component
public class NotifWsHandler extends TextWebSocketHandler {
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();

    private final ObjectMapper objectMapper;
    private final JwtService jwtService;
    private final ChatService chatService;
    private final WsConnectionRegistry notifRegistry;

    public NotifWsHandler(
            ObjectMapper objectMapper,
            JwtService jwtService,
            ChatService chatService,
            @Qualifier("notifRegistry") WsConnectionRegistry notifRegistry
    ) {
        this.objectMapper = objectMapper;
        this.jwtService = jwtService;
        this.chatService = chatService;
        this.notifRegistry = notifRegistry;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.getAttributes().put("authenticated", false);
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
            Map<String, Object> claims;
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
            session.getAttributes().put("authenticated", true);
            session.getAttributes().put("user_id", userId);
            notifRegistry.add(userId, session);
            send(session, Map.of("type", "unread_total", "count", chatService.unreadTotal(userId)));
            send(session, Map.of("type", "unread_notif", "count", chatService.unreadNotif(userId)));
        }
        // keep-alive: ignore payload
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String uid = (String) session.getAttributes().get("user_id");
        if (uid != null) {
            notifRegistry.disconnect(uid, session);
        }
    }

    private static boolean isAuthenticated(WebSocketSession session) {
        Object v = session.getAttributes().get("authenticated");
        return v instanceof Boolean b && b;
    }

    private void send(WebSocketSession session, Map<String, Object> payload) throws Exception {
        synchronized (session) {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(objectMapper.writeValueAsString(payload)));
            }
        }
    }
}
