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
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class UserReviewsIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void reviews_nominal_public_noAuth_sortedDesc() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/reviews").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(4)))
                .andExpect(jsonPath("$[0].review_id", is("rev_001")))
                .andExpect(jsonPath("$[1].review_id", is("rev_002")))
                .andExpect(jsonPath("$[0].reviewer_id", is("user_admin001")))
                .andExpect(jsonPath("$[0].reviewer_name", is("Admin Test")))
                .andExpect(jsonPath("$[0].comment", is("Excellent coach")))
                .andExpect(jsonPath("$[1].comment", nullValue()))
                .andExpect(jsonPath("$[0].created_at", is("2026-04-10T14:30:00.000000+00:00")))
                .andExpect(jsonPath("$[0].booking_id").doesNotExist())
                .andExpect(jsonPath("$[0].reviewee_id").doesNotExist());
    }

    @Test
    void reviews_showReviewsFalse_returnsEmptyArray() throws Exception {
        mockMvc.perform(get("/api/users/user_private001/reviews").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void reviews_userNotFound_returns404() throws Exception {
        mockMvc.perform(get("/api/users/user_unknown/reviews").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("User not found")));
    }

    @Test
    void reviews_invalidToken_ignored_still200() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/reviews")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(4)));
    }

    @Test
    void reviews_coherentWithPublicProfileCount() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/public")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.review_count", is(4)));

        mockMvc.perform(get("/api/users/user_demo001/reviews").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(4)));
    }
}
