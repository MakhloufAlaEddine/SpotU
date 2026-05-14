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

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class FollowListIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void followers_nominal_withAuth_returnsOrderedAndContextFields() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/followers")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].name", is("Admin Test")))
                .andExpect(jsonPath("$[1].name", is("Marie Martin")))
                .andExpect(jsonPath("$[2].name", is("Zoé Robert")))
                .andExpect(jsonPath("$[0].is_following_back", is(false)))
                .andExpect(jsonPath("$[1].is_following_back", is(false)))
                .andExpect(jsonPath("$[1].is_blocked", is(true)));
    }

    @Test
    void followers_withoutToken_returns200AndFalseContextFlags() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/followers").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(3)))
                .andExpect(jsonPath("$[0].is_following_back", is(false)))
                .andExpect(jsonPath("$[0].is_blocked", is(false)));
    }

    @Test
    void followers_invalidToken_returns200Not401() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/followers")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].is_following_back", is(false)));
    }

    @Test
    void followers_unknownUser_returnsEmptyArray() throws Exception {
        mockMvc.perform(get("/api/users/user_unknown/followers").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void following_nominal_withAuth_usesFollowsBackField() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/following")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].name", is("Admin Test")))
                .andExpect(jsonPath("$[1].name", is("Marie Martin")))
                .andExpect(jsonPath("$[0].follows_back", is(false)))
                .andExpect(jsonPath("$[1].follows_back", is(false)))
                .andExpect(jsonPath("$[0].is_following_back").doesNotExist());
    }

    @Test
    void following_withoutToken_returnsFalseFlags() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/following").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].follows_back", is(false)))
                .andExpect(jsonPath("$[0].is_blocked", is(false)));
    }

    @Test
    void coherence_withSlice05_afterFollow_listChanges() throws Exception {
        mockMvc.perform(get("/api/users/user_private001/followers")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));

        mockMvc.perform(post("/api/users/user_private001/follow")
                .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken()));

        mockMvc.perform(get("/api/users/user_private001/followers")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)));
    }
}
