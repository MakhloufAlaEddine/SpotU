package com.spotu.modules.payments.subscription;

import java.util.Map;

/**
 * Notification collectée pendant le traitement webhook (envoyée après persistance event, comme en Python).
 */
public record PendingWebhookNotification(
        String userId,
        String type,
        String title,
        String body,
        Map<String, Object> data
) {
}
