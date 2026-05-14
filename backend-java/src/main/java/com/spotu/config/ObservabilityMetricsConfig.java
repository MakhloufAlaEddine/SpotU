package com.spotu.config;

import com.spotu.modules.chat.ws.WsConnectionRegistry;
import com.spotu.modules.marketplace.service.ProductCreationService;
import com.spotu.modules.push.service.ExpoPushClient;
import com.spotu.modules.spotyou.service.SpotYouPushSideEffectService;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ObservabilityMetricsConfig {

    public ObservabilityMetricsConfig(
            MeterRegistry registry,
            @Qualifier("chatRegistry") WsConnectionRegistry chatRegistry,
            @Qualifier("notifRegistry") WsConnectionRegistry notifRegistry,
            @Qualifier("spotyouRegistry") WsConnectionRegistry spotyouRegistry,
            ExpoPushClient expoPushClient,
            SpotYouPushSideEffectService spotYouPushSideEffectService,
            ProductCreationService productCreationService
    ) {
        Gauge.builder("spotu_ws_active_sessions", chatRegistry, WsConnectionRegistry::activeSessionCount)
                .description("Current active WebSocket sessions")
                .tag("channel", "chat")
                .register(registry);
        Gauge.builder("spotu_ws_active_sessions", notifRegistry, WsConnectionRegistry::activeSessionCount)
                .description("Current active WebSocket sessions")
                .tag("channel", "notifications")
                .register(registry);
        Gauge.builder("spotu_ws_active_sessions", spotyouRegistry, WsConnectionRegistry::activeSessionCount)
                .description("Current active WebSocket sessions")
                .tag("channel", "spotyou")
                .register(registry);

        Gauge.builder("spotu_push_expo_attempted_total", expoPushClient,
                        c -> c.metricsSnapshot().attempted())
                .description("Total Expo push send attempts")
                .register(registry);
        Gauge.builder("spotu_push_expo_sent_total", expoPushClient,
                        c -> c.metricsSnapshot().sent())
                .description("Total Expo push sent")
                .register(registry);
        Gauge.builder("spotu_push_expo_failed_total", expoPushClient,
                        c -> c.metricsSnapshot().failed())
                .description("Total Expo push failures")
                .register(registry);
        Gauge.builder("spotu_push_expo_invalid_total", expoPushClient,
                        c -> c.metricsSnapshot().invalid())
                .description("Total Expo invalid tokens")
                .register(registry);

        Gauge.builder("spotu_push_spotyou_attempted_total", spotYouPushSideEffectService,
                        s -> s.metricsSnapshot().attempted())
                .description("Total SpotYou push attempts")
                .register(registry);
        Gauge.builder("spotu_push_spotyou_success_total", spotYouPushSideEffectService,
                        s -> s.metricsSnapshot().success())
                .description("Total SpotYou push successes")
                .register(registry);
        Gauge.builder("spotu_push_spotyou_failed_total", spotYouPushSideEffectService,
                        s -> s.metricsSnapshot().failed())
                .description("Total SpotYou push failures")
                .register(registry);
        Gauge.builder("spotu_push_spotyou_invalid_total", spotYouPushSideEffectService,
                        s -> s.metricsSnapshot().invalidToken())
                .description("Total SpotYou invalid tokens")
                .register(registry);

        Gauge.builder("spotu_marketplace_async_attempted_total", productCreationService,
                        s -> s.asyncMetricsSnapshot().attempted())
                .description("Total marketplace async attempts")
                .register(registry);
        Gauge.builder("spotu_marketplace_async_success_total", productCreationService,
                        s -> s.asyncMetricsSnapshot().success())
                .description("Total marketplace async successes")
                .register(registry);
        Gauge.builder("spotu_marketplace_async_failed_total", productCreationService,
                        s -> s.asyncMetricsSnapshot().failed())
                .description("Total marketplace async failures")
                .register(registry);
    }
}
