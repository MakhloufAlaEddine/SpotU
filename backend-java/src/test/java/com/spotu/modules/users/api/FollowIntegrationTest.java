package com.spotu.modules.users.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class FollowIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void follow_nominal_returnsTrueAndUpdatedCount() throws Exception {
        mockMvc.perform(post("/api/users/user_private001/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(true)))
                .andExpect(jsonPath("$.followers_count", is(1)));
    }

    @Test
    void follow_doubleFollow_isIdempotent() throws Exception {
        mockMvc.perform(post("/api/users/user_private001/follow")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));
        mockMvc.perform(post("/api/users/user_private001/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(true)))
                .andExpect(jsonPath("$.followers_count", is(1)));
    }

    @Test
    void unfollow_nominal_returnsFalseAndUpdatedCount() throws Exception {
        mockMvc.perform(delete("/api/users/user_demo001/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(false)))
                .andExpect(jsonPath("$.followers_count", is(2)));
    }

    @Test
    void unfollow_nonExistingRelation_isSilent200() throws Exception {
        mockMvc.perform(delete("/api/users/user_private001/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(false)))
                .andExpect(jsonPath("$.followers_count", is(1)));
    }

    @Test
    void follow_selfFollow_returns400WithExactFrenchMessage() throws Exception {
        mockMvc.perform(post("/api/users/user_demo001/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Vous ne pouvez pas vous suivre vous-même.")));
    }

    @Test
    void follow_targetMissing_returns404() throws Exception {
        mockMvc.perform(post("/api/users/user_inexistant_xxxx/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Utilisateur introuvable.")));
    }

    @Test
    void unfollow_targetMissing_returns200Silent() throws Exception {
        mockMvc.perform(delete("/api/users/user_inexistant_xxxx/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(false)))
                .andExpect(jsonPath("$.followers_count", is(0)));
    }

    @Test
    void follow_withoutToken_returns401() throws Exception {
        mockMvc.perform(post("/api/users/user_private001/follow").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void follow_invalidToken_returns401() throws Exception {
        mockMvc.perform(post("/api/users/user_private001/follow")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void follow_thenPublicProfile_isFollowingTrue() throws Exception {
        mockMvc.perform(post("/api/users/user_private001/follow")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));

        mockMvc.perform(get("/api/users/user_private001/public")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(true)))
                .andExpect(jsonPath("$.followers_count", is(1)));
    }
}
