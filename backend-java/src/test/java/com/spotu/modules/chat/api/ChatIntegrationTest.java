package com.spotu.modules.chat.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ChatIntegrationTest {
    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void initChatTables() {
        jdbcTemplate.update("DELETE FROM messages");
        jdbcTemplate.update("DELETE FROM conversation_participants");
        jdbcTemplate.update("DELETE FROM conversations");
    }

    @Test
    void createServiceConversation_isIdempotent() throws Exception {
        String payload = objectMapper.writeValueAsString(Map.of("type", "service", "context_id", "svc_001"));
        String first = mockMvc.perform(post("/api/conversations")
                        .contentType("application/json")
                        .content(payload)
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type", is("service")))
                .andReturn().getResponse().getContentAsString();
        String convId = objectMapper.readTree(first).path("conversation_id").asText();

        mockMvc.perform(post("/api/conversations")
                        .contentType("application/json")
                        .content(payload)
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.conversation_id", is(convId)));
    }

    @Test
    void createTagpointPrivate_createsConversationWithOwnerAndCaller() throws Exception {
        String payload = objectMapper.writeValueAsString(Map.of("type", "tagpoint_private", "context_id", "tp_001"));
        mockMvc.perform(post("/api/conversations")
                        .contentType("application/json")
                        .content(payload)
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type", is("tagpoint_private")))
                .andExpect(jsonPath("$.context_id", is("tp_001")));

        Integer participants = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM conversation_participants cp " +
                        "JOIN conversations c ON c.conversation_id = cp.conversation_id " +
                        "WHERE c.type = 'tagpoint_private' AND c.context_id = 'tp_001'",
                Integer.class
        );
        org.junit.jupiter.api.Assertions.assertEquals(2, participants);
    }

    @Test
    void createTagpointGroup_forbiddenWhenNotMember() throws Exception {
        String payload = objectMapper.writeValueAsString(Map.of("type", "tagpoint_group", "context_id", "tp_001"));
        mockMvc.perform(post("/api/conversations")
                        .contentType("application/json")
                        .content(payload)
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Vous devez être membre de ce SpotYou pour accéder au groupe")));
    }

    @Test
    void listMessages_marksReadAndReturnsChronological() throws Exception {
        seedConversation("conv_test", "service", "svc_001", "user_private001", "user_demo001");
        seedMessage("msg_001", "conv_test", "user_demo001", "first", "2026-05-01T10:00:00Z");
        seedMessage("msg_002", "conv_test", "user_demo001", "second", "2026-05-01T11:00:00Z");

        mockMvc.perform(get("/api/conversations/conv_test/messages")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].message_id", is("msg_001")))
                .andExpect(jsonPath("$[1].message_id", is("msg_002")));
    }

    @Test
    void putRead_silentWhenNotParticipant() throws Exception {
        mockMvc.perform(put("/api/conversations/conv_unknown/read")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));
    }

    @Test
    void deleteMessage_enforcesOwnerOrAdmin_andIdempotent() throws Exception {
        seedConversation("conv_test", "service", "svc_001", "user_private001", "user_demo001");
        seedMessage("msg_001", "conv_test", "user_private001", "hello", "2026-05-01T10:00:00Z");

        mockMvc.perform(delete("/api/messages/msg_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken()))
                .andExpect(status().isForbidden());

        mockMvc.perform(delete("/api/messages/msg_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted", is(true)));

        mockMvc.perform(delete("/api/messages/msg_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.already_deleted", is(true)));
    }

    @Test
    void leaveConversation_idempotentAnd404WhenNotParticipant() throws Exception {
        seedConversation("conv_test", "service", "svc_001", "user_private001", "user_demo001");
        mockMvc.perform(patch("/api/conversations/conv_test/leave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.left", is(true)));

        mockMvc.perform(patch("/api/conversations/conv_test/leave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.already_left", is(true)));

        mockMvc.perform(patch("/api/conversations/conv_test/leave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken()))
                .andExpect(status().isNotFound());
    }

    private void seedConversation(String convId, String type, String contextId, String u1, String u2) {
        jdbcTemplate.update(
                "INSERT INTO conversations (conversation_id, type, context_id, context_title, created_by, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                convId, type, contextId, contextId, u1
        );
        jdbcTemplate.update("INSERT INTO conversation_participants (conversation_id, user_id, status) VALUES (?, ?, 'active')", convId, u1);
        jdbcTemplate.update("INSERT INTO conversation_participants (conversation_id, user_id, status) VALUES (?, ?, 'active')", convId, u2);
    }

    private void seedMessage(String messageId, String convId, String senderId, String content, String iso) {
        jdbcTemplate.update(
                "INSERT INTO messages (message_id, conversation_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
                messageId, convId, senderId, content, Timestamp.from(Instant.parse(iso))
        );
    }
}
