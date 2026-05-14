package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.data.redis.connection.RedisConnectionFactory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class WsClusterRelayConfigTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(WsClusterRelayConfig.class)
            .withBean(ObjectMapper.class, ObjectMapper::new);

    @Test
    void fallbackNoop_whenClusterDisabled() {
        runner.withPropertyValues(
                        "app.ws.cluster.enabled=false",
                        "app.ws.cluster.provider=noop"
                )
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(WsClusterRelay.class);
                    assertThat(ctx.getBean(WsClusterRelay.class)).isInstanceOf(NoopWsClusterRelay.class);
                });
    }

    @Test
    void redisRelay_whenEnabledAndProviderRedis() {
        runner.withPropertyValues(
                        "app.ws.cluster.enabled=true",
                        "app.ws.cluster.provider=redis",
                        "app.ws.cluster.instance-id=node-test"
                )
                .withBean(RedisConnectionFactory.class, () -> mock(RedisConnectionFactory.class))
                .run(ctx -> {
                    assertThat(ctx).hasSingleBean(WsClusterRelay.class);
                    assertThat(ctx.getBean(WsClusterRelay.class)).isInstanceOf(RedisWsClusterRelay.class);
                });
    }
}
