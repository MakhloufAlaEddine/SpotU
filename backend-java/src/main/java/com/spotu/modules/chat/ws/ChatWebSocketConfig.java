package com.spotu.modules.chat.ws;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSocket
public class ChatWebSocketConfig implements WebSocketConfigurer {
    private final ChatWsHandler chatWsHandler;
    private final NotifWsHandler notifWsHandler;
    private final SpotYouWsHandler spotYouWsHandler;
    private final String allowedOriginsRaw;

    public ChatWebSocketConfig(
            ChatWsHandler chatWsHandler,
            NotifWsHandler notifWsHandler,
            SpotYouWsHandler spotYouWsHandler,
            @Value("${app.ws.allowed-origins:http://localhost:3000,http://localhost:19006,http://localhost:8081}") String allowedOriginsRaw
    ) {
        this.chatWsHandler = chatWsHandler;
        this.notifWsHandler = notifWsHandler;
        this.spotYouWsHandler = spotYouWsHandler;
        this.allowedOriginsRaw = allowedOriginsRaw;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        String[] allowedOrigins = parseAllowedOrigins();
        registry.addHandler(chatWsHandler, "/api/ws/chat/*").setAllowedOrigins(allowedOrigins);
        registry.addHandler(notifWsHandler, "/api/ws/notifications").setAllowedOrigins(allowedOrigins);
        registry.addHandler(spotYouWsHandler, "/api/ws/spot-you/*").setAllowedOrigins(allowedOrigins);
    }

    private String[] parseAllowedOrigins() {
        List<String> origins = Arrays.stream(allowedOriginsRaw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
        return origins.toArray(new String[0]);
    }
}
