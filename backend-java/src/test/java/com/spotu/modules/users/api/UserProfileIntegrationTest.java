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
class UserProfileIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void usersMe_nominal_returns23FieldsWithRatingAndBanking() throws Exception {
        mockMvc.perform(get("/api/users/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_demo001")))
                .andExpect(jsonPath("$.avg_rating", is(4.2)))
                .andExpect(jsonPath("$.review_count", is(4)))
                .andExpect(jsonPath("$.iban", is("FR76 3000 6000 0112 3456 7890 189")))
                .andExpect(jsonPath("$.bic", is("BNPAFRPPXXX")))
                .andExpect(jsonPath("$.iban_name", is("Thomas Dupont")))
                .andExpect(jsonPath("$.created_at", is("2026-04-01T12:51:14.682000+00:00")))
                .andExpect(jsonPath("$.updated_at", is("2026-04-02T13:36:04.382240+00:00")));
    }

    @Test
    void usersMe_userWithoutReviews_returnsNullAverageAndZeroCount() throws Exception {
        mockMvc.perform(get("/api/users/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_admin001")))
                .andExpect(jsonPath("$.avg_rating", nullValue()))
                .andExpect(jsonPath("$.review_count", is(0)))
                .andExpect(jsonPath("$.iban", nullValue()))
                .andExpect(jsonPath("$.bic", nullValue()))
                .andExpect(jsonPath("$.iban_name", nullValue()));
    }

    @Test
    void usersMe_withoutToken_returns401() throws Exception {
        mockMvc.perform(get("/api/users/me").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void usersMe_invalidToken_returns401() throws Exception {
        mockMvc.perform(get("/api/users/me")
                        .header("Authorization", "Bearer not-a-jwt")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void usersMe_unknownUser_returns401() throws Exception {
        mockMvc.perform(get("/api/users/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.unknownUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("User not found")));
    }

    @Test
    void usersProfile_alias_matchesUsersMeContract() throws Exception {
        mockMvc.perform(get("/api/users/profile")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_demo001")))
                .andExpect(jsonPath("$.avg_rating", is(4.2)))
                .andExpect(jsonPath("$.review_count", is(4)));
    }
}
