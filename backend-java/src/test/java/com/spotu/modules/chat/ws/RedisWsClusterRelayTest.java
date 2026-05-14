package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class RedisWsClusterRelayTest {

    @Test
    void publish_writesEnvelopeWithInstanceId() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        RedisWsClusterRelay relay = new RedisWsClusterRelay(new ObjectMapper(), redis, null, "node-a");

        relay.publish("chat.conv", "conv_1", Map.of("type", "message"));

        ArgumentCaptor<String> bodyCaptor = ArgumentCaptor.forClass(String.class);
        verify(redis).convertAndSend(eq("chat.conv"), bodyCaptor.capture());
        String sent = bodyCaptor.getValue();
        assertTrue(sent.contains("\"instance_id\":\"node-a\""));
        assertTrue(sent.contains("\"key\":\"conv_1\""));
    }

    @Test
    void onRedisMessage_ignoresOwnInstanceMessages() throws Exception {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        RedisWsClusterRelay relay = new RedisWsClusterRelay(new ObjectMapper(), redis, null, "node-a");
        AtomicReference<String> calledKey = new AtomicReference<>();
        relay.subscribe("chat.conv", (key, payload) -> calledKey.set(key));

        String raw = """
                {"instance_id":"node-a","key":"conv_1","payload":{"type":"message"}}
                """;
        relay.onRedisMessage("chat.conv", raw);

        assertEquals(null, calledKey.get());
    }

    @Test
    void onRedisMessage_dispatchesOtherInstanceMessages() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        RedisWsClusterRelay relay = new RedisWsClusterRelay(new ObjectMapper(), redis, null, "node-a");
        AtomicReference<String> calledKey = new AtomicReference<>();
        relay.subscribe("chat.conv", (key, payload) -> calledKey.set(key));

        String raw = "{\"instance_id\":\"node-b\",\"key\":\"conv_2\",\"payload\":{\"type\":\"message\"}}";
        relay.onRedisMessage("chat.conv", raw);

        assertEquals("conv_2", calledKey.get());
    }
}
