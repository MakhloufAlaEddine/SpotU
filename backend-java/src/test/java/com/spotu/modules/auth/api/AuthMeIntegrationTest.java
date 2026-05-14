package com.spotu.modules.auth.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthMeIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void me_withoutToken_returns401NotAuthenticated() throws Exception {
        mockMvc.perform(get("/api/auth/me").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void me_withBearerEmpty_returns401NotAuthenticated_likePythonTruthyCheck() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer ")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void me_withValidToken_returns200AndExactly18Fields() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_demo001")))
                .andExpect(jsonPath("$.email", is("user@winek.app")))
                .andExpect(jsonPath("$.name", is("Thomas Dupont")))
                .andExpect(jsonPath("$.role", is("coach")))
                .andExpect(jsonPath("$.language", is("fr")))
                .andExpect(jsonPath("$.is_coach_verified", is(true)))
                .andExpect(jsonPath("$.show_phone", is(true)))
                .andExpect(jsonPath("$.show_reviews", is(true)))
                .andExpect(jsonPath("$.sports_level", nullValue()))
                .andExpect(jsonPath("$.onboarding_done", is(false)))
                .andExpect(jsonPath("$.created_at", is("2026-04-01T12:51:14.682000+00:00")))
                .andExpect(jsonPath("$.updated_at", is("2026-04-02T13:36:04.382240+00:00")))
                .andExpect(jsonPath("$.coach_tags.length()", is(4)))
                .andExpect(jsonPath("$.goals.length()", is(0)))
                .andExpect(jsonPath("$.user_roles.length()", is(0)))
                .andReturn();

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.size()).isEqualTo(18);
        assertThat(body.has("password_hash")).isFalse();
        assertThat(body.has("stripe_customer_id")).isFalse();
    }

    @Test
    void me_withWinekCookie_returns200() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .cookie(new jakarta.servlet.http.Cookie("winek_token", TestJwtTokens.validCoachToken()))
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_demo001")));
    }

    @Test
    void me_withBasicAuthHeaderNoCookie_returns401NotAuthenticated() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Basic dXNlcjpwYXNz")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void me_withBadSignature_returns401InvalidToken() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.wrongSignatureToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void me_withMalformedToken_returns401InvalidToken() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer not-a-jwt")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void me_withExpiredToken_returns401TokenExpired() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.expiredToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Token expired")));
    }

    @Test
    void me_withRs256Header_returns401InvalidTokenAlgorithm() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.rs256HeaderToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token algorithm")));
    }

    @Test
    void me_withMissingUserIdClaim_returns401InvalidToken() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.missingUserIdToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void me_withMissingExpClaim_returns401InvalidToken() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.missingExpToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Invalid token")));
    }

    @Test
    void me_withUnknownUserId_returns401UserNotFound() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.unknownUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("User not found")));
    }

    @Test
    void me_adminToken_returnsRoleFromDatabase() throws Exception {
        mockMvc.perform(get("/api/auth/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user_id", is("user_admin001")))
                .andExpect(jsonPath("$.role", is("admin")));
    }
}
