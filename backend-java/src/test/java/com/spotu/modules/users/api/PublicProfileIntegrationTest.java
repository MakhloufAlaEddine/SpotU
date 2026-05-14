package com.spotu.modules.users.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PublicProfileIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void publicProfile_nominalCoach_withoutToken_returns200AndNoAuthError() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/public")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_demo001")))
                .andExpect(jsonPath("$.role", is("coach")))
                .andExpect(jsonPath("$.show_phone", is(true)))
                .andExpect(jsonPath("$.phone", is("+33 6 12 34 56 78")))
                .andExpect(jsonPath("$.is_following", is(false)))
                .andExpect(jsonPath("$.avg_rating", is(4.2)))
                .andExpect(jsonPath("$.review_count", is(4)))
                .andExpect(jsonPath("$.services.length()", is(2)))
                .andExpect(jsonPath("$.interests.length()", is(2)))
                .andExpect(jsonPath("$.tag_points.length()", is(15)));
    }

    @Test
    void publicProfile_invalidToken_returns200AndIsFollowingFalse() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/public")
                        .header("Authorization", "Bearer invalid-token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(false)));
    }

    @Test
    void publicProfile_authenticatedFollower_setsIsFollowingTrue() throws Exception {
        mockMvc.perform(get("/api/users/user_demo001/public")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_following", is(true)));
    }

    @Test
    void publicProfile_nonCoach_hidesPhoneAndOmitsServices() throws Exception {
        mockMvc.perform(get("/api/users/user_private001/public")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.show_phone", is(false)))
                .andExpect(jsonPath("$.phone", nullValue()))
                .andExpect(jsonPath("$.show_reviews", is(false)))
                .andExpect(jsonPath("$.avg_rating", nullValue()))
                .andExpect(jsonPath("$.review_count", is(0)))
                .andExpect(jsonPath("$.services").doesNotExist());
    }

    @Test
    void publicProfile_userNotFound_returns404Detail() throws Exception {
        mockMvc.perform(get("/api/users/user_unknown/public")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("User not found")));
    }
}
