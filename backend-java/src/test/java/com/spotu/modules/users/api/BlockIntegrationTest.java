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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BlockIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void block_nominal_removesFollowsBothDirections() throws Exception {
        mockMvc.perform(post("/api/users/user_admin001/block")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blocked", is(true)));

        mockMvc.perform(get("/api/users/user_admin001/public")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(false)));

        mockMvc.perform(get("/api/users/user_demo001/followers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2))); // admin removed from followers list
    }

    @Test
    void block_doubleBlock_isIdempotent() throws Exception {
        mockMvc.perform(post("/api/users/user_admin001/block")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));
        mockMvc.perform(post("/api/users/user_admin001/block")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blocked", is(true)));
    }

    @Test
    void block_selfBlock_returns400ExactMessage() throws Exception {
        mockMvc.perform(post("/api/users/user_demo001/block")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Vous ne pouvez pas vous bloquer vous-même.")));
    }

    @Test
    void block_withoutToken_returns401() throws Exception {
        mockMvc.perform(post("/api/users/user_admin001/block").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void unblock_nominal_returnsBlockedFalse() throws Exception {
        mockMvc.perform(post("/api/users/user_admin001/block")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));

        mockMvc.perform(delete("/api/users/user_admin001/block")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blocked", is(false)));
    }

    @Test
    void unblock_nonExisting_isSilent200() throws Exception {
        mockMvc.perform(delete("/api/users/user_private001/block")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.blocked", is(false)));
    }

    @Test
    void unblock_doesNotRestoreFollows() throws Exception {
        mockMvc.perform(post("/api/users/user_admin001/block")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));
        mockMvc.perform(delete("/api/users/user_admin001/block")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));

        mockMvc.perform(get("/api/users/user_admin001/public")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(false)));
    }

    @Test
    void blockUnblockThenFollow_followWorksAgain() throws Exception {
        mockMvc.perform(post("/api/users/user_admin001/block")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));
        mockMvc.perform(delete("/api/users/user_admin001/block")
                .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken()));

        mockMvc.perform(post("/api/users/user_admin001/follow")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(true)));
    }
}
