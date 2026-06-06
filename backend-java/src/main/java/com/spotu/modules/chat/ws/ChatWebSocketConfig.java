package com.spotu.modules.chat.ws;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.util.Arrays;

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
            @Value("${app.ws.allowed-origins:*}") String allowedOriginsRaw
    ) {
        this.chatWsHandler = chatWsHandler;
        this.notifWsHandler = notifWsHandler;
        this.spotYouWsHandler = spotYouWsHandler;
        this.allowedOriginsRaw = allowedOriginsRaw;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        String[] allowedPatterns = parseAllowedPatterns();
        registry.addHandler(chatWsHandler, "/api/ws/chat/*").setAllowedOriginPatterns(allowedPatterns);
        registry.addHandler(notifWsHandler, "/api/ws/notifications").setAllowedOriginPatterns(allowedPatterns);
        registry.addHandler(spotYouWsHandler, "/api/ws/spot-you/*").setAllowedOriginPatterns(allowedPatterns);
    }

    private String[] parseAllowedPatterns() {
        if (allowedOriginsRaw == null || allowedOriginsRaw.isBlank() || "*".equals(allowedOriginsRaw.trim())) {
            return new String[] { "*" };
        }
        return Arrays.stream(allowedOriginsRaw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toArray(String[]::new);
    }
}
