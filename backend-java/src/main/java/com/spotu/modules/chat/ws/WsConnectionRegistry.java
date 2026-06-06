package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class WsConnectionRegistry {
    private static final Logger log = LoggerFactory.getLogger(WsConnectionRegistry.class);

    private final Map<String, CopyOnWriteArrayList<WebSocketSession>> active = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper;
    private final WsClusterRelay clusterRelay;
    private final String clusterTopic;

    public WsConnectionRegistry(ObjectMapper objectMapper) {
        this(objectMapper, null, "ws.default");
    }

    public WsConnectionRegistry(ObjectMapper objectMapper, WsClusterRelay clusterRelay, String clusterTopic) {
        this.objectMapper = objectMapper;
        this.clusterRelay = clusterRelay;
        this.clusterTopic = clusterTopic == null ? "ws.default" : clusterTopic;
        if (this.clusterRelay != null) {
            this.clusterRelay.subscribe(this.clusterTopic, this::broadcastLocal);
        }
    }

    public void add(String key, WebSocketSession ws) {
        active.computeIfAbsent(key, k -> new CopyOnWriteArrayList<>()).add(ws);
    }

    public void disconnect(String key, WebSocketSession ws) {
        List<WebSocketSession> sessions = active.get(key);
        if (sessions == null) {
            return;
        }
        sessions.removeIf(s -> s == ws);
    }

    public int activeSessionCount() {
        return active.values().stream().mapToInt(List::size).sum();
    }

    /** True si l'utilisateur a une session chat WS ouverte sur cette conversation. */
    public boolean hasUserConnected(String key, String userId) {
        if (userId == null || userId.isBlank()) {
            return false;
        }
        List<WebSocketSession> sessions = active.get(key);
        if (sessions == null || sessions.isEmpty()) {
            return false;
        }
        for (WebSocketSession ws : sessions) {
            if (!ws.isOpen()) {
                continue;
            }
            Object uid = ws.getAttributes().get("user_id");
            if (userId.equals(uid == null ? null : String.valueOf(uid))) {
                return true;
            }
        }
        return false;
    }

    public void broadcast(String key, Map<String, Object> payload) {
        broadcastLocal(key, payload);
        if (clusterRelay != null) {
            clusterRelay.publish(clusterTopic, key, payload);
        }
    }

    void broadcastLocal(String key, Map<String, Object> payload) {
        List<WebSocketSession> sessions = active.get(key);
        if (sessions == null || sessions.isEmpty()) {
            return;
        }
        final String json;
        try {
            json = objectMapper.writeValueAsString(payload);
        } catch (Exception ex) {
            log.warn("[WS] payload serialization error key={}", key, ex);
            return;
        }
        TextMessage msg = new TextMessage(json);
        for (WebSocketSession ws : sessions) {
            try {
                synchronized (ws) {
                    if (ws.isOpen()) {
                        ws.sendMessage(msg);
                    }
                }
            } catch (Exception ex) {
                log.warn("[WS] dead session key={}", key, ex);
                disconnect(key, ws);
            }
        }
    }
}
