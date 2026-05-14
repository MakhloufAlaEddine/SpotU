package com.spotu.modules.chat.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import java.net.URI;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ChatWebSocketIntegrationTest {
    @LocalServerPort
    int port;
    @Autowired
    JdbcTemplate jdbcTemplate;
    @Autowired
    ObjectMapper objectMapper;

    @BeforeEach
    void setupConv() {
        jdbcTemplate.update("DELETE FROM messages");
        jdbcTemplate.update("DELETE FROM conversation_participants");
        jdbcTemplate.update("DELETE FROM conversations");
        jdbcTemplate.update(
                "INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by, created_at, last_message_at) VALUES ('conv_ws', 'service', 'svc_001', 'svc_001', 'user_private001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        );
        jdbcTemplate.update("INSERT INTO conversation_participants (conversation_id, user_id, status) VALUES ('conv_ws', 'user_private001', 'active')");
        jdbcTemplate.update("INSERT INTO conversation_participants (conversation_id, user_id, status) VALUES ('conv_ws', 'user_demo001', 'active')");
        jdbcTemplate.update("INSERT INTO conversation_participants (conversation_id, user_id, status) VALUES ('conv_ws', 'user_zoe001', 'left')");
    }

    @TestConfiguration
    static class WsTestContainerConfig {
        @Bean
        ServletServerContainerFactoryBean createWebSocketContainer() {
            ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
            container.setMaxTextMessageBufferSize(64 * 1024);
            container.setMaxBinaryMessageBufferSize(64 * 1024);
            return container;
        }
    }

    @Test
    void wsChat_authTimeout_closes4001() throws Exception {
        CountDownLatch closed = new CountDownLatch(1);
        AtomicReference<CloseStatus> statusRef = new AtomicReference<>();
        var handler = new AbstractWebSocketHandler() {
            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
                statusRef.set(status);
                closed.countDown();
            }
        };
        StandardWebSocketClient client = new StandardWebSocketClient();
        WebSocketSession session = client.execute(handler, "ws://localhost:" + port + "/api/ws/chat/conv_ws").get(5, TimeUnit.SECONDS);
        assertTrue(closed.await(7, TimeUnit.SECONDS));
        assertEquals(4001, statusRef.get().getCode());
        session.close();
    }

    @Test
    void wsChat_leftParticipant_closes4003() throws Exception {
        CountDownLatch closed = new CountDownLatch(1);
        AtomicReference<CloseStatus> statusRef = new AtomicReference<>();
        CountDownLatch opened = new CountDownLatch(1);
        var handler = new AbstractWebSocketHandler() {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) {
                opened.countDown();
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
                statusRef.set(status);
                closed.countDown();
            }
        };
        StandardWebSocketClient client = new StandardWebSocketClient();
        WebSocketSession session = client.execute(handler, "ws://localhost:" + port + "/api/ws/chat/conv_ws").get(5, TimeUnit.SECONDS);
        assertTrue(opened.await(2, TimeUnit.SECONDS));
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(Map.of("token", TestJwtTokens.validZoeToken()))));
        assertTrue(closed.await(5, TimeUnit.SECONDS));
        assertEquals(4003, statusRef.get().getCode());
    }

    @Test
    void wsChat_messageTooLarge_closes4009() throws Exception {
        CountDownLatch closed = new CountDownLatch(1);
        AtomicReference<CloseStatus> statusRef = new AtomicReference<>();
        CompletableFuture<WebSocketSession> sessionRef = new CompletableFuture<>();
        var handler = new AbstractWebSocketHandler() {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) {
                sessionRef.complete(session);
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
                statusRef.set(status);
                closed.countDown();
            }
        };
        StandardWebSocketClient client = new StandardWebSocketClient();
        client.execute(handler, "ws://localhost:" + port + "/api/ws/chat/conv_ws").get(5, TimeUnit.SECONDS);
        WebSocketSession session = sessionRef.get(2, TimeUnit.SECONDS);
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(Map.of("token", TestJwtTokens.validUserToken()))));
        String big = "a".repeat(8200);
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(Map.of("content", big))));
        assertTrue(closed.await(5, TimeUnit.SECONDS));
        assertEquals(4009, statusRef.get().getCode());
    }

    @Test
    void wsChat_disallowedOrigin_rejectedAtHandshake() {
        StandardWebSocketClient client = new StandardWebSocketClient();
        WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
        headers.add("Origin", "http://evil-origin.test");

        assertThrows(
                ExecutionException.class,
                () -> client.execute(
                        new AbstractWebSocketHandler() {},
                        headers,
                        URI.create("ws://localhost:" + port + "/api/ws/chat/conv_ws")
                ).get(5, TimeUnit.SECONDS)
        );
    }
}
