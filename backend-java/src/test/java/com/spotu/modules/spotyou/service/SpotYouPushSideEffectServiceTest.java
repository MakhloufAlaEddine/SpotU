package com.spotu.modules.spotyou.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.spotu.modules.push.infra.PushTokenRepository;
import com.spotu.modules.push.service.ExpoPushClient;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class SpotYouPushSideEffectServiceTest {

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private PushTokenRepository pushTokenRepository;

    @Mock
    private ExpoPushClient expoPushClient;

    @InjectMocks
    private SpotYouPushSideEffectService service;

    @Test
    void fireAndForget_pushSpotYouNominal_insertsNotificationAndSendsPush() throws Exception {
        when(objectMapper.writeValueAsString(anyMap())).thenReturn("{\"type\":\"spotyu_join\"}");
        when(pushTokenRepository.findActiveExpoTokensByUserId("u1"))
                .thenReturn(List.of("ExponentPushToken[a]"));
        when(expoPushClient.send(eq("ExponentPushToken[a]"), eq("Titre"), eq("Body"), anyMap()))
                .thenReturn(ExpoPushClient.PushSendResult.SENT);

        service.fireAndForget("u1", "spotyu_join", "Titre", "Body", Map.of("type", "spotyu_join"));

        verify(jdbcTemplate).update(anyString(), anyString(), eq("u1"), eq("spotyu_join"), eq("Titre"), eq("Body"), anyString());
        verify(expoPushClient).send(eq("ExponentPushToken[a]"), eq("Titre"), eq("Body"), anyMap());
        SpotYouPushSideEffectService.MetricsSnapshot snapshot = service.metricsSnapshot();
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.attempted());
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.success());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.failed());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.retryAttempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.invalidToken());
    }

    @Test
    void fireAndForget_invalidToken_disablesToken() throws Exception {
        when(objectMapper.writeValueAsString(anyMap())).thenReturn("{\"type\":\"spotyu_join\"}");
        when(pushTokenRepository.findActiveExpoTokensByUserId("u2"))
                .thenReturn(List.of("ExponentPushToken[bad]"));
        when(expoPushClient.send(eq("ExponentPushToken[bad]"), eq("Titre"), eq("Body"), anyMap()))
                .thenReturn(ExpoPushClient.PushSendResult.INVALID_TOKEN);

        service.fireAndForget("u2", "spotyu_join", "Titre", "Body", Map.of("type", "spotyu_join"));

        verify(pushTokenRepository).deactivateByToken("ExponentPushToken[bad]");
        SpotYouPushSideEffectService.MetricsSnapshot snapshot = service.metricsSnapshot();
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.attempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.success());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.failed());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.retryAttempted());
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.invalidToken());
    }

    @Test
    void fireAndForget_expoError_nonBlocking() throws Exception {
        when(objectMapper.writeValueAsString(anyMap())).thenReturn("{\"type\":\"spotyu_join\"}");
        when(pushTokenRepository.findActiveExpoTokensByUserId("u3"))
                .thenReturn(List.of("ExponentPushToken[err]"));
        when(expoPushClient.send(eq("ExponentPushToken[err]"), eq("Titre"), eq("Body"), anyMap()))
                .thenThrow(new RuntimeException("expo down"));

        assertDoesNotThrow(() ->
                service.fireAndForget("u3", "spotyu_join", "Titre", "Body", Map.of("type", "spotyu_join"))
        );
        SpotYouPushSideEffectService.MetricsSnapshot snapshot = service.metricsSnapshot();
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.attempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.success());
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.failed());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.retryAttempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.invalidToken());
    }

    @Test
    void fireAndForget_jsonSerializationError_nonBlocking() throws Exception {
        when(objectMapper.writeValueAsString(anyMap()))
                .thenThrow(new JsonProcessingException("bad json") {});

        assertDoesNotThrow(() ->
                service.fireAndForget("u4", "spotyu_join", "Titre", "Body", Map.of("type", "spotyu_join"))
        );
        SpotYouPushSideEffectService.MetricsSnapshot snapshot = service.metricsSnapshot();
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.attempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.success());
        org.junit.jupiter.api.Assertions.assertEquals(1, snapshot.failed());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.retryAttempted());
        org.junit.jupiter.api.Assertions.assertEquals(0, snapshot.invalidToken());
    }
}
