package com.spotu.modules.users.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
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
    void activityFeed_nominal_returnsGoingAndJoinedActivities() throws Exception {
        mockMvc.perform(get("/api/users/me/activity-feed")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activities", hasSize(3)))
                .andExpect(jsonPath("$.activities[0].type", is("going")))
                .andExpect(jsonPath("$.activities[0].user_id", is("user_admin001")))
                .andExpect(jsonPath("$.activities[0].action_text", is("vient jeudi")))
                .andExpect(jsonPath("$.activities[0].spot_you_title", is("Running matinal")))
                .andExpect(jsonPath("$.activities[1].type", is("going")))
                .andExpect(jsonPath("$.activities[1].user_id", is("user_demo001")))
                .andExpect(jsonPath("$.activities[2].type", is("joined")))
                .andExpect(jsonPath("$.activities[2].user_id", is("user_admin001")))
                .andExpect(jsonPath("$.activities[2].action_text", is("a rejoint")))
                .andExpect(jsonPath("$.activities[2].session_date", nullValue()));
    }

    @Test
    void reactivatable_nominal_returnsStructureWithDeletedSpotYou() throws Exception {
        mockMvc.perform(get("/api/users/me/reactivatable")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.spotyous").isArray())
                .andExpect(jsonPath("$.services").isArray())
                .andExpect(jsonPath("$.products").isArray())
                .andExpect(jsonPath("$.spotyous[0].id", is("tp_s29_deleted_pending")))
                .andExpect(jsonPath("$.spotyous[0].type", is("spotyou")))
                .andExpect(jsonPath("$.spotyous[0].days_until_media_purge").exists());
    }

    @Test
    void myEvents_nominal_returnsAcceptedMemberships() throws Exception {
        mockMvc.perform(get("/api/users/me/events")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$[*].point_id", hasItem("tp_001")))
                .andExpect(jsonPath("$[0].is_owner", is(true)))
                .andExpect(jsonPath("$[0].joined_at").exists());
    }

    @Test
    void reactivatable_and_events_withoutToken_return401() throws Exception {
        mockMvc.perform(get("/api/users/me/reactivatable").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/users/me/events").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void activityFeed_withoutToken_returns401() throws Exception {
        mockMvc.perform(get("/api/users/me/activity-feed").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
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
