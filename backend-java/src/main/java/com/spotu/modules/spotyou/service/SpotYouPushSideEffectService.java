package com.spotu.modules.spotyou.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.push.infra.PushTokenRepository;
import com.spotu.modules.push.service.ExpoPushClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;

/**
 * Équivalent pragmatique de {@code asyncio.create_task(send_push_to_user(...))} :
 * persistance {@code notifications} + envoi Expo fire-and-forget.
 */
@Service
public class SpotYouPushSideEffectService {

    private static final Logger log = LoggerFactory.getLogger(SpotYouPushSideEffectService.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final PushTokenRepository pushTokenRepository;
    private final ExpoPushClient expoPushClient;
    private final LongAdder attempted = new LongAdder();
    private final LongAdder success = new LongAdder();
    private final LongAdder failed = new LongAdder();
    private final LongAdder retryAttempted = new LongAdder();
    private final LongAdder invalidToken = new LongAdder();

    public SpotYouPushSideEffectService(
            JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper,
            PushTokenRepository pushTokenRepository,
            ExpoPushClient expoPushClient
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
        this.pushTokenRepository = pushTokenRepository;
        this.expoPushClient = expoPushClient;
    }

    @Async
    public void fireAndForget(
            String recipientUserId,
            String notifType,
            String title,
            String body,
            Map<String, Object> data
    ) {
        try {
            String notifId = "notif_" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 16);
            String dataJson = data == null || data.isEmpty() ? "{}" : objectMapper.writeValueAsString(data);
            jdbcTemplate.update(
                    """
                            INSERT INTO notifications (notif_id, user_id, type, title, body, data)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                    notifId, recipientUserId, notifType, title, body, dataJson
            );
            List<String> tokens = pushTokenRepository.findActiveExpoTokensByUserId(recipientUserId);
            int attempted = 0;
            int sent = 0;
            int failed = 0;
            int invalidDisabled = 0;
            for (String token : tokens) {
                attempted++;
                this.attempted.increment();
                ExpoPushClient.PushSendResult result;
                try {
                    result = expoPushClient.send(token, title, body, data);
                } catch (Exception ex) {
                    failed++;
                    this.failed.increment();
                    continue;
                }
                if (result == ExpoPushClient.PushSendResult.SENT) {
                    sent++;
                    this.success.increment();
                } else if (result == ExpoPushClient.PushSendResult.INVALID_TOKEN) {
                    pushTokenRepository.deactivateByToken(token);
                    invalidDisabled++;
                    this.invalidToken.increment();
                } else if (result == ExpoPushClient.PushSendResult.FAILED) {
                    failed++;
                    this.failed.increment();
                }
            }
            log.info("spotyou_push_summary user_id={} type={} attempted={} sent={} failed={} invalid_token_disabled={} retry_attempted={}",
                    recipientUserId, notifType, attempted, sent, failed, invalidDisabled, 0);
        } catch (JsonProcessingException e) {
            this.failed.increment();
            log.warn("SpotYou push side-effect JSON error: {}", e.getMessage());
        } catch (Exception e) {
            this.failed.increment();
            log.warn("SpotYou push side-effect failed for user={}: {}", recipientUserId, e.getMessage());
        }
    }

    public MetricsSnapshot metricsSnapshot() {
        return new MetricsSnapshot(
                attempted.longValue(),
                success.longValue(),
                failed.longValue(),
                retryAttempted.longValue(),
                invalidToken.longValue()
        );
    }

    public record MetricsSnapshot(
            long attempted,
            long success,
            long failed,
            long retryAttempted,
            long invalidToken
    ) {
    }
}
