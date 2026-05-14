package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.service.JwtService;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@Component
public class SpotYouWsHandler extends TextWebSocketHandler {
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();
    private final ObjectMapper objectMapper;
    private final JwtService jwtService;
    private final WsConnectionRegistry spotyouRegistry;

    public SpotYouWsHandler(
            ObjectMapper objectMapper,
            JwtService jwtService,
            @Qualifier("spotyouRegistry") WsConnectionRegistry spotyouRegistry
    ) {
        this.objectMapper = objectMapper;
        this.jwtService = jwtService;
        this.spotyouRegistry = spotyouRegistry;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.getAttributes().put("point_id", extractLastPathSegment(session.getUri()));
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
            String pointId = (String) session.getAttributes().get("point_id");
            spotyouRegistry.add(pointId, session);
            session.getAttributes().put("authenticated", true);
        }
        // keep-alive ignore
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String pointId = (String) session.getAttributes().get("point_id");
        if (pointId != null) {
            spotyouRegistry.disconnect(pointId, session);
        }
    }

    private static boolean isAuthenticated(WebSocketSession session) {
        Object v = session.getAttributes().get("authenticated");
        return v instanceof Boolean b && b;
    }

    private static String extractLastPathSegment(URI uri) {
        if (uri == null) return null;
        String p = uri.getPath();
        if (p == null || p.isBlank()) return null;
        int idx = p.lastIndexOf('/');
        return idx >= 0 ? p.substring(idx + 1) : p;
    }
}
