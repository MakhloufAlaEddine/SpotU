package com.spotu.modules.notifications.service;

import com.spotu.modules.push.infra.PushTokenRepository;
import com.spotu.modules.push.service.ExpoPushClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotifBroadcasterTest {

    @Mock
    private PushTokenRepository pushTokenRepository;

    @Mock
    private ExpoPushClient expoPushClient;

    @InjectMocks
    private NotifBroadcaster notifBroadcaster;

    @Test
    void notify_pushNotificationNominal_sendsToActiveTokens() {
        when(pushTokenRepository.findActiveExpoTokensByUserId("u1"))
                .thenReturn(List.of("ExponentPushToken[a]"));
        when(expoPushClient.send(eq("ExponentPushToken[a]"), eq("Notification SpotU"), eq("unread_notif"), anyMap()))
                .thenReturn(ExpoPushClient.PushSendResult.SENT);

        notifBroadcaster.notify("u1", Map.of("type", "unread_notif", "count", 2));

        verify(expoPushClient).send(eq("ExponentPushToken[a]"), eq("Notification SpotU"), eq("unread_notif"), anyMap());
    }

    @Test
    void notify_invalidToken_disablesToken() {
        when(pushTokenRepository.findActiveExpoTokensByUserId("u2"))
                .thenReturn(List.of("ExponentPushToken[bad]"));
        when(expoPushClient.send(eq("ExponentPushToken[bad]"), eq("Notification SpotU"), eq("notification"), anyMap()))
                .thenReturn(ExpoPushClient.PushSendResult.INVALID_TOKEN);

        notifBroadcaster.notify("u2", Map.of());

        verify(pushTokenRepository).deactivateByToken("ExponentPushToken[bad]");
    }
}
