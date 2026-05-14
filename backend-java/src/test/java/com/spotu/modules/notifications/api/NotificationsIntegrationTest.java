package com.spotu.modules.notifications.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.sql.Timestamp;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class NotificationsIntegrationTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void listInbox_nominal_order_limit_andSenderPictureOverride() throws Exception {
        clearNotifications();
        insertNotif("ntf_001", "user_private001", "{\"sender_id\":\"user_demo001\",\"sender_picture\":\"OLD.jpg\"}", false, "2026-05-01 10:00:00+00:00");
        insertNotif("ntf_002", "user_private001", "{\"sender_id\":\"user_zoe001\",\"sender_picture\":\"KEEP.jpg\"}", false, "2026-05-01 11:00:00+00:00");
        insertNotif("ntf_003", "user_private001", "", true, "2026-05-01 12:00:00+00:00");
        insertNotif("ntf_004", "user_zoe001", "{\"sender_id\":\"user_demo001\"}", false, "2026-05-01 13:00:00+00:00");

        mockMvc.perform(get("/api/users/me/notifications")
                        .queryParam("limit", "2")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].id", is("ntf_003")))
                .andExpect(jsonPath("$[0].data").isMap())
                .andExpect(jsonPath("$[1].id", is("ntf_002")))
                .andExpect(jsonPath("$[1].data.sender_picture", is("KEEP.jpg")));

        mockMvc.perform(get("/api/users/me/notifications")
                        .queryParam("limit", "10")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[2].id", is("ntf_001")))
                .andExpect(jsonPath("$[2].data.sender_picture", containsString("https://images.pexels.com")))
                .andExpect(jsonPath("$[2].created_at", containsString("+00:00")));
    }

    @Test
    void listInbox_requiresAuth_andValidatesLimit422() throws Exception {
        clearNotifications();
        mockMvc.perform(get("/api/users/me/notifications"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/users/me/notifications")
                        .queryParam("limit", "0")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isUnprocessableEntity());

        mockMvc.perform(get("/api/users/me/notifications")
                        .queryParam("limit", "abc")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void markRead_isSilentForMissingOrOtherOwner_andReturnsUnreadCount() throws Exception {
        clearNotifications();
        insertNotif("ntf_101", "user_private001", "{}", false, "2026-05-01 10:00:00+00:00");
        insertNotif("ntf_102", "user_private001", "{}", false, "2026-05-01 11:00:00+00:00");
        insertNotif("ntf_201", "user_zoe001", "{}", false, "2026-05-01 12:00:00+00:00");

        mockMvc.perform(patch("/api/users/me/notifications/ntf_101/read")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.unread_notif", is(1)));

        mockMvc.perform(patch("/api/users/me/notifications/not_found/read")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unread_notif", is(1)));

        mockMvc.perform(patch("/api/users/me/notifications/ntf_201/read")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unread_notif", is(1)));
    }

    @Test
    void markAllRead_returnsSuccessOnly_andSetsAllRead() throws Exception {
        clearNotifications();
        insertNotif("ntf_301", "user_private001", "{}", false, "2026-05-01 10:00:00+00:00");
        insertNotif("ntf_302", "user_private001", "{}", false, "2026-05-01 11:00:00+00:00");

        mockMvc.perform(patch("/api/users/me/notifications/read-all")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.unread_notif").doesNotExist());

        Integer unread = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = FALSE",
                Integer.class,
                "user_private001"
        );
        org.junit.jupiter.api.Assertions.assertEquals(0, unread == null ? 0 : unread);
    }

    private void insertNotif(String notifId, String userId, String data, boolean read, String createdAt) {
        String iso = createdAt.replace(" ", "T").replace("+00:00", "Z");
        jdbcTemplate.update(
                """
                INSERT INTO notifications (notif_id, user_id, type, title, body, data, read, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                notifId, userId, "booking_request", "Title", "Body", data, read, Timestamp.from(Instant.parse(iso))
        );
    }

    private void clearNotifications() {
        jdbcTemplate.update("DELETE FROM notifications");
    }
}
