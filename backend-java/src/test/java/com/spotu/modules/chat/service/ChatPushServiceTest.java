package com.spotu.modules.chat.service;

import com.spotu.modules.push.infra.PushTokenRepository;
import com.spotu.modules.push.service.ExpoPushClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ChatPushServiceTest {

    @Mock
    private PushTokenRepository pushTokenRepository;

    @Mock
    private ExpoPushClient expoPushClient;

    @InjectMocks
    private ChatPushService chatPushService;

    @Test
    void sendToUser_sendsPushToAllActiveExpoTokens() {
        when(pushTokenRepository.findActiveExpoTokensByUserId("user_1"))
                .thenReturn(List.of("ExponentPushToken[token_a]", "ExponentPushToken[token_b]"));

        Map<String, Object> data = Map.of("type", "chat_message", "conversationId", "conv_1");
        chatPushService.sendToUser("user_1", "Alice", "Salut", data, false);

        verify(expoPushClient).send("ExponentPushToken[token_a]", "Alice", "Salut", data);
        verify(expoPushClient).send("ExponentPushToken[token_b]", "Alice", "Salut", data);
    }

    @Test
    void sendToUser_noActiveToken_doesNotCallExpo() {
        when(pushTokenRepository.findActiveExpoTokensByUserId("user_2")).thenReturn(List.of());

        chatPushService.sendToUser("user_2", "Alice", "Salut", Map.of(), false);

        verify(expoPushClient, never()).send(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyMap());
    }
}
