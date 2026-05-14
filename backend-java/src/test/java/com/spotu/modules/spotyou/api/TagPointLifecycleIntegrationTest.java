package com.spotu.modules.spotyou.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class TagPointLifecycleIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void delete_nominal_owner() throws Exception {
        mockMvc.perform(delete("/api/tag-points/tp_s29_active")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.deleted", is(true)))
                .andExpect(jsonPath("$.point_id", is("tp_s29_active")))
                .andExpect(jsonPath("$.conversations_marked", is(2)))
                .andExpect(jsonPath("$.images_queued", is(2)))
                .andExpect(jsonPath("$.members_notified", is(2)))
                .andExpect(jsonPath("$.media_purge_scheduled_at", notNullValue()));

        Integer active = jdbcTemplate.queryForObject(
                "SELECT CASE WHEN active THEN 1 ELSE 0 END FROM tag_points WHERE point_id = ?",
                Integer.class,
                "tp_s29_active"
        );
        Assertions.assertEquals(0, active);
    }

    @Test
    void delete_not_found_then_conflict_then_forbidden_order() throws Exception {
        mockMvc.perform(delete("/api/tag-points/does_not_exist_s29")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("SpotYou introuvable")));

        mockMvc.perform(delete("/api/tag-points/tp_s29_deleted_pending")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Ce SpotYou est déjà supprimé")));

        mockMvc.perform(delete("/api/tag-points/tp_s29_active")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Non autorisé")));
    }

    @Test
    void delete_without_token_returns401() throws Exception {
        mockMvc.perform(delete("/api/tag-points/tp_s29_active")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void reactivate_nominal_pending_only_cancelled() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s29_deleted_pending/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.reactivated", is(true)))
                .andExpect(jsonPath("$.point_id", is("tp_s29_deleted_pending")))
                .andExpect(jsonPath("$.media_purged", is(false)))
                .andExpect(jsonPath("$.requires_media_reupload", is(false)))
                .andExpect(jsonPath("$.pending_deletions_cancelled", is(2)));

        Integer pending = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM pending_file_deletions WHERE entity_id = ? AND status = 'pending'",
                Integer.class,
                "tp_s29_deleted_pending"
        );
        Assertions.assertEquals(0, pending);
    }

    @Test
    void reactivate_media_already_purged_requires_reupload() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s29_deleted_purged/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.media_purged", is(true)))
                .andExpect(jsonPath("$.requires_media_reupload", is(true)))
                .andExpect(jsonPath("$.pending_deletions_cancelled", is(0)));
    }

    @Test
    void reactivate_404_409_403_and_401() throws Exception {
        mockMvc.perform(post("/api/tag-points/does_not_exist_s29/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("SpotYou introuvable")));

        mockMvc.perform(post("/api/tag-points/tp_s29_active/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Ce SpotYou est déjà actif")));

        mockMvc.perform(post("/api/tag-points/tp_s29_deleted_pending/reactivate")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Non autorisé")));

        mockMvc.perform(post("/api/tag-points/tp_s29_deleted_pending/reactivate")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}

