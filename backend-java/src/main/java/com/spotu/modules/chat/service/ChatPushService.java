package com.spotu.modules.chat.service;

import com.spotu.modules.push.infra.PushTokenRepository;
import com.spotu.modules.push.service.ExpoPushClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class ChatPushService {
    private static final Logger log = LoggerFactory.getLogger(ChatPushService.class);

    private final PushTokenRepository pushTokenRepository;
    private final ExpoPushClient expoPushClient;

    public ChatPushService(PushTokenRepository pushTokenRepository, ExpoPushClient expoPushClient) {
        this.pushTokenRepository = pushTokenRepository;
        this.expoPushClient = expoPushClient;
    }

    public void sendToUser(String userId, String title, String body, Map<String, Object> data, boolean store) {
        List<String> tokens = pushTokenRepository.findActiveExpoTokensByUserId(userId);
        int attempted = 0;
        int sent = 0;
        int failed = 0;
        int invalidDisabled = 0;
        for (String token : tokens) {
            attempted++;
            ExpoPushClient.PushSendResult result;
            try {
                result = expoPushClient.send(token, title, body, data);
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
        if (attempted == 0) {
            log.info("chat_push_summary user_id={} attempted=0 (no active token or push disabled)", userId);
        } else {
            log.info("chat_push_summary user_id={} attempted={} sent={} failed={} invalid_token_disabled={}",
                    userId, attempted, sent, failed, invalidDisabled);
        }
    }
}
