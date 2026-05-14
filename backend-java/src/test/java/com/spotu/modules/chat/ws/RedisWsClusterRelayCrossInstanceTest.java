package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

class RedisWsClusterRelayCrossInstanceTest {

    @Test
    void crossInstancePublish_deliversToOtherInstance_ignoresOwn_noLoop() throws Exception {
        ObjectMapper mapper = new ObjectMapper();

        StringRedisTemplate redisA = mock(StringRedisTemplate.class);
        StringRedisTemplate redisB = mock(StringRedisTemplate.class);

        RedisWsClusterRelay relayA = new RedisWsClusterRelay(mapper, redisA, null, "node-a");
        RedisWsClusterRelay relayB = new RedisWsClusterRelay(mapper, redisB, null, "node-b");

        WsConnectionRegistry registryA = new WsConnectionRegistry(mapper, relayA, "chat.conv");
        WsConnectionRegistry registryB = new WsConnectionRegistry(mapper, relayB, "chat.conv");

        WebSocketSession wsA = mock(WebSocketSession.class);
        WebSocketSession wsB = mock(WebSocketSession.class);
        when(wsA.isOpen()).thenReturn(true);
        when(wsB.isOpen()).thenReturn(true);
        registryA.add("conv_x", wsA);
        registryB.add("conv_x", wsB);

        registryA.broadcast("conv_x", Map.of("type", "message", "text", "hello"));

        ArgumentCaptor<String> rawCaptor = ArgumentCaptor.forClass(String.class);
        verify(redisA, times(1)).convertAndSend(eq("chat.conv"), rawCaptor.capture());
        String raw = rawCaptor.getValue();

        // Simule fanout Redis sur tous les subscribers (incluant l'instance émettrice).
        relayA.onRedisMessage("chat.conv", raw);
        relayB.onRedisMessage("chat.conv", raw);

        // A reçoit le local direct une seule fois; son propre message Redis est ignoré.
        verify(wsA, times(1)).sendMessage(any(TextMessage.class));
        // B reçoit via le canal Redis et broadcast localement.
        verify(wsB, times(1)).sendMessage(any(TextMessage.class));
        // B ne republie pas le message reçu du broker (pas de boucle infinie).
        verify(redisB, never()).convertAndSend(eq("chat.conv"), any(String.class));
    }
}
