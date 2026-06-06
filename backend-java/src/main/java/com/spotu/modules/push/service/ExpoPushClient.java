package com.spotu.modules.push.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;

@Component
public class ExpoPushClient {

    private static final Logger log = LoggerFactory.getLogger(ExpoPushClient.class);

    private final RestTemplate restTemplate;
    private final boolean enabled;
    private final String endpoint;
    private final LongAdder attempted = new LongAdder();
    private final LongAdder sent = new LongAdder();
    private final LongAdder failed = new LongAdder();
    private final LongAdder invalid = new LongAdder();

    public ExpoPushClient(
            @Value("${app.push.expo-enabled:true}") boolean enabled,
            @Value("${app.push.expo-endpoint:https://exp.host/--/api/v2/push/send}") String endpoint
    ) {
        this.enabled = enabled;
        this.endpoint = endpoint;
        this.restTemplate = new RestTemplate();
        if (!enabled) {
            log.warn("Expo push disabled (EXPO_PUSH_ENABLED=false) — aucune notification push ne sera envoyée");
        }
    }

    public PushSendResult send(String expoToken, String title, String body, Map<String, Object> data) {
        if (!enabled) {
            return PushSendResult.SKIPPED;
        }
        if (expoToken == null || !expoToken.startsWith("ExponentPushToken[")) {
            return PushSendResult.SKIPPED;
        }
        attempted.increment();
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("to", expoToken);
            payload.put("title", title);
            payload.put("body", body);
            payload.put("data", data == null ? Map.of() : data);
            payload.put("sound", "default");
            payload.put("priority", "high");
            payload.put("channelId", "default");
            String responseBody = restTemplate
                    .postForEntity(endpoint, new HttpEntity<>(payload, headers), String.class)
                    .getBody();
            if (looksLikeInvalidToken(responseBody)) {
                invalid.increment();
                log.info("push_result=invalid_token attempted={} sent={} failed={} invalid={}",
                        attempted.longValue(), sent.longValue(), failed.longValue(), invalid.longValue());
                return PushSendResult.INVALID_TOKEN;
            }
            sent.increment();
            log.info("push_result=sent attempted={} sent={} failed={} invalid={}",
                    attempted.longValue(), sent.longValue(), failed.longValue(), invalid.longValue());
            return PushSendResult.SENT;
        } catch (Exception ex) {
            failed.increment();
            log.warn("Expo push send failed: {}", ex.getMessage());
            log.info("push_result=failed attempted={} sent={} failed={} invalid={}",
                    attempted.longValue(), sent.longValue(), failed.longValue(), invalid.longValue());
            return PushSendResult.FAILED;
        }
    }

    private boolean looksLikeInvalidToken(String responseBody) {
        if (responseBody == null || responseBody.isBlank()) {
            return false;
        }
        return responseBody.contains("DeviceNotRegistered")
                || responseBody.contains("not a registered push notification recipient")
                || responseBody.contains("INVALID_CREDENTIAL");
    }

    public enum PushSendResult {
        SENT,
        INVALID_TOKEN,
        FAILED,
        SKIPPED
    }

    public MetricsSnapshot metricsSnapshot() {
        return new MetricsSnapshot(
                attempted.longValue(),
                sent.longValue(),
                failed.longValue(),
                invalid.longValue()
        );
    }

    public record MetricsSnapshot(
            long attempted,
            long sent,
            long failed,
            long invalid
    ) {
    }
}
