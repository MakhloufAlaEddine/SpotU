package com.spotu.modules.notifications.service;

import com.spotu.modules.push.infra.PushTokenRepository;
import com.spotu.modules.push.service.ExpoPushClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class NotifBroadcaster {
    private static final Logger log = LoggerFactory.getLogger(NotifBroadcaster.class);

    private final PushTokenRepository pushTokenRepository;
    private final ExpoPushClient expoPushClient;

    public NotifBroadcaster(PushTokenRepository pushTokenRepository, ExpoPushClient expoPushClient) {
        this.pushTokenRepository = pushTokenRepository;
        this.expoPushClient = expoPushClient;
    }

    public void notify(String userId, Map<String, Object> payload) {
        String title = "Notification SpotU";
        String body = payload == null ? "" : String.valueOf(payload.getOrDefault("type", "notification"));
        List<String> tokens = pushTokenRepository.findActiveExpoTokensByUserId(userId);
        int attempted = 0;
        int sent = 0;
        int failed = 0;
        int invalidDisabled = 0;
        for (String token : tokens) {
            attempted++;
            ExpoPushClient.PushSendResult result;
            try {
                result = expoPushClient.send(token, title, body, payload);
            } catch (Exception ex) {
                failed++;
                continue;
            }
            if (result == ExpoPushClient.PushSendResult.SENT) {
                sent++;
            } else if (result == ExpoPushClient.PushSendResult.INVALID_TOKEN) {
                pushTokenRepository.deactivateByToken(token);
                invalidDisabled++;
            } else if (result == ExpoPushClient.PushSendResult.FAILED) {
                failed++;
            }
        }
        log.info("notif_push_summary user_id={} attempted={} sent={} failed={} invalid_token_disabled={}",
                userId, attempted, sent, failed, invalidDisabled);
    }
}
