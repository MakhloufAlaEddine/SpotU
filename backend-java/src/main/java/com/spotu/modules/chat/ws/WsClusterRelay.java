package com.spotu.modules.chat.ws;

import java.util.Map;
import java.util.function.BiConsumer;

public interface WsClusterRelay {
    void publish(String topic, String key, Map<String, Object> payload);

    void subscribe(String topic, BiConsumer<String, Map<String, Object>> handler);
}
