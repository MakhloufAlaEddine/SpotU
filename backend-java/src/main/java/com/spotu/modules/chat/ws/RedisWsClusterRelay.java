package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.listener.Topic;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BiConsumer;

public class RedisWsClusterRelay implements WsClusterRelay {
    private static final Logger log = LoggerFactory.getLogger(RedisWsClusterRelay.class);
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redis;
    private final RedisMessageListenerContainer listenerContainer;
    private final String instanceId;

    private final Map<String, CopyOnWriteArrayList<BiConsumer<String, Map<String, Object>>>> subscribers = new ConcurrentHashMap<>();
    private final Set<String> listeningTopics = ConcurrentHashMap.newKeySet();

    public RedisWsClusterRelay(
            ObjectMapper objectMapper,
            StringRedisTemplate redis,
            RedisMessageListenerContainer listenerContainer,
            String instanceId
    ) {
        this.objectMapper = objectMapper;
        this.redis = redis;
        this.listenerContainer = listenerContainer;
        this.instanceId = instanceId == null || instanceId.isBlank() ? "ws-instance" : instanceId;
    }

    @Override
    public void publish(String topic, String key, Map<String, Object> payload) {
        try {
            Map<String, Object> envelope = Map.of(
                    "instance_id", instanceId,
                    "key", key,
                    "payload", payload == null ? Map.of() : payload
            );
            redis.convertAndSend(topic, objectMapper.writeValueAsString(envelope));
        } catch (Exception ex) {
            log.warn("Redis WS publish failed topic={} key={}: {}", topic, key, ex.getMessage());
        }
    }

    @Override
    public void subscribe(String topic, BiConsumer<String, Map<String, Object>> handler) {
        subscribers.computeIfAbsent(topic, t -> new CopyOnWriteArrayList<>()).add(handler);
        if (listeningTopics.add(topic) && listenerContainer != null) {
            listenerContainer.addMessageListener(redisListener(), topic(topic));
        }
    }

    void onRedisMessage(String topic, String raw) {
        try {
            Map<String, Object> event = objectMapper.readValue(raw, MAP_TYPE);
            String sender = String.valueOf(event.getOrDefault("instance_id", ""));
            if (instanceId.equals(sender)) {
                return;
            }
            String key = String.valueOf(event.getOrDefault("key", ""));
            Object payloadObj = event.get("payload");
            Map<String, Object> payload = payloadObj instanceof Map<?, ?> m
                    ? objectMapper.convertValue(m, MAP_TYPE)
                    : Map.of();
            List<BiConsumer<String, Map<String, Object>>> handlers = subscribers.get(topic);
            if (handlers == null) {
                return;
            }
            for (BiConsumer<String, Map<String, Object>> h : handlers) {
                h.accept(key, payload);
            }
        } catch (Exception ex) {
            log.warn("Redis WS consume failed topic={}: {}", topic, ex.getMessage());
        }
    }

    private MessageListener redisListener() {
        return new MessageListener() {
            @Override
            public void onMessage(Message message, byte[] pattern) {
                String topic = new String(message.getChannel(), StandardCharsets.UTF_8);
                String raw = new String(message.getBody(), StandardCharsets.UTF_8);
                onRedisMessage(topic, raw);
            }
        };
    }

    private Topic topic(String name) {
        return new ChannelTopic(name);
    }
}
