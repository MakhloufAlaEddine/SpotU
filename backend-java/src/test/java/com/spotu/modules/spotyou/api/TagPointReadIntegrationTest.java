package com.spotu.modules.spotyou.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TagPointReadIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void search_withoutAuth_returnsAllActiveSpots() throws Exception {
        mockMvc.perform(get("/api/tag-points").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(16)));
    }

    @Test
    void search_withCoachToken_excludesOwnSpots() throws Exception {
        mockMvc.perform(get("/api/tag-points")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].point_id", is("tp_admin001")));
    }

    @Test
    void search_domainFilter() throws Exception {
        mockMvc.perform(get("/api/tag-points").param("domain_id", "dom_sport")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(16)));
    }

    @Test
    void search_tagIdsFilter() throws Exception {
        mockMvc.perform(get("/api/tag-points").param("tag_ids", "tag_hatha")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].point_id", is("tp_002")));
    }

    @Test
    void mine_nominal_returnsActiveOwned() throws Exception {
        mockMvc.perform(get("/api/tag-points/mine")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(15)))
                .andExpect(jsonPath("$[0].can_participate", is(true)))
                .andExpect(jsonPath("$[0].participants_count", greaterThanOrEqualTo(0)));
    }

    @Test
    void mine_withoutAuth_returns401() throws Exception {
        mockMvc.perform(get("/api/tag-points/mine").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void saved_nominal() throws Exception {
        mockMvc.perform(get("/api/tag-points/saved")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].point_id", is("tp_001")))
                .andExpect(jsonPath("$[0].is_saved", is(true)));
    }

    @Test
    void detail_anonymous_nominal() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_001").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.point_id", is("tp_001")))
                .andExpect(jsonPath("$.votes", is(2)))
                .andExpect(jsonPath("$.participants_count", is(2)))
                .andExpect(jsonPath("$.tags", hasSize(1)))
                .andExpect(jsonPath("$.is_going", is(false)))
                .andExpect(jsonPath("$.is_saved", is(false)))
                .andExpect(jsonPath("$.rating_distribution['5']", is(1)))
                .andExpect(jsonPath("$.rating_distribution['4']", is(1)));
    }

    @Test
    void detail_notFound_returns404() throws Exception {
        mockMvc.perform(get("/api/tag-points/does_not_exist").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("TagPoint not found")));
    }

    @Test
    void detail_inactive_nonOwner_returns404() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_inactive").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("SpotYou non disponible")));
    }

    @Test
    void detail_inactive_owner_returns200() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_inactive")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_owner", is(true)));
    }

    @Test
    void participants_public_nominal() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_001/participants").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].is_creator", is(true)));
    }

    @Test
    void similar_unknown_returns200Empty() throws Exception {
        mockMvc.perform(get("/api/tag-points/unknown_id/similar").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void pendingRequests_nominal() throws Exception {
        mockMvc.perform(get("/api/users/me/pending-requests")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(5)))
                .andExpect(jsonPath("$[*].point_id", hasItem("tp_002")));
    }

    @Test
    void pendingRequests_withoutAuth_returns401() throws Exception {
        mockMvc.perform(get("/api/users/me/pending-requests").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void detail_withMember_showsJoinStatus() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.join_status", is("accepted")))
                .andExpect(jsonPath("$.is_participant", is(true)));
    }

    @Test
    void detail_pendingUser_showsPendingJoinStatus() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_002")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.join_status", is("pending")))
                .andExpect(jsonPath("$.is_participant", is(false)));
    }

}
