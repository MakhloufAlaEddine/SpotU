package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

@Configuration
public class WsClusterRelayConfig {

    @Bean
    @Primary
    @ConditionalOnProperty(name = "app.ws.cluster.enabled", havingValue = "true")
    @ConditionalOnProperty(name = "app.ws.cluster.provider", havingValue = "redis")
    public WsClusterRelay redisRelay(
            ObjectMapper objectMapper,
            StringRedisTemplate redisTemplate,
            RedisMessageListenerContainer listenerContainer,
            @Value("${app.ws.cluster.instance-id:${HOSTNAME:spotu-ws}}") String instanceId
    ) {
        return new RedisWsClusterRelay(objectMapper, redisTemplate, listenerContainer, instanceId);
    }

    @Bean
    @Primary
    @ConditionalOnProperty(name = "app.ws.cluster.enabled", havingValue = "false", matchIfMissing = true)
    public WsClusterRelay noopRelayDisabled() {
        return new NoopWsClusterRelay();
    }

    @Bean
    @Primary
    @ConditionalOnProperty(name = "app.ws.cluster.enabled", havingValue = "true")
    @ConditionalOnProperty(name = "app.ws.cluster.provider", havingValue = "noop", matchIfMissing = true)
    public WsClusterRelay noopRelayProvider() {
        return new NoopWsClusterRelay();
    }

    @Bean
    @ConditionalOnProperty(name = "app.ws.cluster.enabled", havingValue = "true")
    @ConditionalOnProperty(name = "app.ws.cluster.provider", havingValue = "redis")
    public StringRedisTemplate wsRedisTemplate(RedisConnectionFactory factory) {
        return new StringRedisTemplate(factory);
    }

    @Bean
    @ConditionalOnProperty(name = "app.ws.cluster.enabled", havingValue = "true")
    @ConditionalOnProperty(name = "app.ws.cluster.provider", havingValue = "redis")
    public RedisMessageListenerContainer wsRedisListenerContainer(RedisConnectionFactory factory) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        return container;
    }
}
