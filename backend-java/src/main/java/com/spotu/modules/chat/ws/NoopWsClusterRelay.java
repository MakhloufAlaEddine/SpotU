package com.spotu.modules.chat.ws;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.function.BiConsumer;

public class NoopWsClusterRelay implements WsClusterRelay {
    @Override
    public void publish(String topic, String key, Map<String, Object> payload) {
        // Sous-lot P0-05: bridge cluster-ready, backend local inchangé.
    }

    @Override
    public void subscribe(String topic, BiConsumer<String, Map<String, Object>> handler) {
        // Sous-lot P0-05: pas de broker distribué branché ici.
    }
}
