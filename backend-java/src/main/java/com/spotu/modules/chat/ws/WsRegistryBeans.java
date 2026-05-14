package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class WsRegistryBeans {

    @Bean(name = "chatRegistry")
    public WsConnectionRegistry chatRegistry(ObjectMapper objectMapper, WsClusterRelay relay) {
        return new WsConnectionRegistry(objectMapper, relay, "chat.conv");
    }

    @Bean(name = "notifRegistry")
    public WsConnectionRegistry notifRegistry(ObjectMapper objectMapper, WsClusterRelay relay) {
        return new WsConnectionRegistry(objectMapper, relay, "chat.notif");
    }

    @Bean(name = "spotyouRegistry")
    public WsConnectionRegistry spotyouRegistry(ObjectMapper objectMapper, WsClusterRelay relay) {
        return new WsConnectionRegistry(objectMapper, relay, "chat.spotyou");
    }
}
