package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WsConnectionRegistryTest {

    @Test
    void broadcast_sendsLocalAndPublishesToRelay() throws Exception {
        WsClusterRelay relay = mock(WsClusterRelay.class);
        WsConnectionRegistry registry = new WsConnectionRegistry(new ObjectMapper(), relay, "chat.conv");
        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.isOpen()).thenReturn(true);
        registry.add("conv_1", ws);

        registry.broadcast("conv_1", Map.of("type", "message", "text", "hello"));

        verify(relay).publish(eq("chat.conv"), eq("conv_1"), any());
        verify(ws).sendMessage(any(TextMessage.class));
    }

    @Test
    void clusterMessage_fromRelay_isBroadcastedLocallyOnly() throws Exception {
        FakeRelay relay = new FakeRelay();
        WsConnectionRegistry registry = new WsConnectionRegistry(new ObjectMapper(), relay, "chat.conv");
        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.isOpen()).thenReturn(true);
        registry.add("conv_2", ws);

        relay.emit("chat.conv", "conv_2", Map.of("type", "cluster", "text", "from-remote"));

        verify(ws).sendMessage(any(TextMessage.class));
        assertEquals(0, relay.publishCount);
    }

    @Test
    void broadcast_withoutSession_keepsPublish() {
        WsClusterRelay relay = mock(WsClusterRelay.class);
        WsConnectionRegistry registry = new WsConnectionRegistry(new ObjectMapper(), relay, "chat.notif");

        registry.broadcast("user_x", Map.of("type", "unread_total", "count", 1));

        verify(relay).publish(eq("chat.notif"), eq("user_x"), any());
    }

    static class FakeRelay implements WsClusterRelay {
        private final AtomicReference<BiConsumer<String, Map<String, Object>>> handlerRef = new AtomicReference<>();
        int publishCount = 0;

        @Override
        public void publish(String topic, String key, Map<String, Object> payload) {
            publishCount++;
        }

        @Override
        public void subscribe(String topic, BiConsumer<String, Map<String, Object>> handler) {
            handlerRef.set(handler);
        }

        void emit(String topic, String key, Map<String, Object> payload) {
            BiConsumer<String, Map<String, Object>> handler = handlerRef.get();
            assertNotNull(handler);
            handler.accept(key, payload);
        }
    }
}
