package com.spotu.modules.chat.service;

import com.spotu.modules.chat.ws.WsConnectionRegistry;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class SpotYouWsBridge {
    private final WsConnectionRegistry spotyouRegistry;

    public SpotYouWsBridge(@Qualifier("spotyouRegistry") WsConnectionRegistry spotyouRegistry) {
        this.spotyouRegistry = spotyouRegistry;
    }

    public void broadcast(String pointId, Map<String, Object> payload) {
        spotyouRegistry.broadcast(pointId, payload);
    }
}
