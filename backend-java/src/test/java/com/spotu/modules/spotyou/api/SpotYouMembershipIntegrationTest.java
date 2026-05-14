package com.spotu.modules.spotyou.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
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
@Transactional
class SpotYouMembershipIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void save_nominal_then_idempotent() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_002/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.is_saved", is(true)));
        mockMvc.perform(post("/api/tag-points/tp_002/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_saved", is(true)));
    }

    @Test
    void save_inactive_returns404() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_inactive/save")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("SpotYou non disponible")));
    }

    @Test
    void unsave_always_success() throws Exception {
        mockMvc.perform(delete("/api/tag-points/tp_unknown/unsave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_saved", is(false)));
    }

    @Test
    void join_open_accepted() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_001/join")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("accepted")))
                .andExpect(jsonPath("$.is_participant", is(true)))
                .andExpect(jsonPath("$.participants_count", greaterThanOrEqualTo(2)));
    }

    @Test
    void join_owner_returns400() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_001/join")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", containsString("créateur")));
    }

    @Test
    void join_private_returns403() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_private/join")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", containsString("invitation")));
    }

    @Test
    void join_full_returns409() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_full/join")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", containsString("capacité")));
    }

    @Test
    void join_admin_approval_returns_pending() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_admin/join")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("pending")))
                .andExpect(jsonPath("$.is_participant", is(false)));
    }

    @Test
    void join_after_rejected_reopens() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_rejoin/join")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("accepted")));
    }

    @Test
    void cancel_request_nominal() throws Exception {
        mockMvc.perform(delete("/api/tag-points/tp_002/cancel-request")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message", is("Demande annulée")));
    }

    @Test
    void cancel_request_not_pending_returns400() throws Exception {
        mockMvc.perform(delete("/api/tag-points/tp_001/cancel-request")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest());
    }

    @Test
    void leave_inactive_allowed() throws Exception {
        mockMvc.perform(delete("/api/tag-points/tp_inactive/leave")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.is_participant", is(false)));
    }

    @Test
    void invite_admin_only_member_forbidden() throws Exception {
        String body = "{\"invited_user_id\":\"user_zoe001\"}";
        mockMvc.perform(post("/api/tag-points/tp_s27_inv_admin/invite")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden());
    }

    @Test
    void invite_admin_and_members_by_member_ok() throws Exception {
        String body = "{\"invited_user_id\":\"user_private001\"}";
        mockMvc.perform(post("/api/tag-points/tp_s27_inv_mem/invite")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));
    }

    @Test
    void my_invitations_contains_invited_point() throws Exception {
        mockMvc.perform(get("/api/users/me/spotyou-invitations")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].point_id", hasItem("tp_s27_invited")))
                .andExpect(jsonPath("$[*].point_id", hasItem("tp_s27_invited2")));
    }

    @Test
    void accept_invitation_nominal() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_invited/invitations/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("accepted")))
                .andExpect(jsonPath("$.success", is(true)));
    }

    @Test
    void refuse_invitation_nominal() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_invited2/invitations/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("rejected")));
    }

    @Test
    void join_requests_owner_lists_pending() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_s27_jr/join-requests")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].user_id", is("user_zoe001")))
                .andExpect(jsonPath("$[0].requested_at").exists());
    }

    @Test
    void join_requests_accepted_member_on_members_mode_ok() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_s27_jr/join-requests")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void join_requests_member_on_admin_mode_forbidden() throws Exception {
        mockMvc.perform(get("/api/tag-points/tp_s27_admin/join-requests")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden());
    }

    @Test
    void approve_admin_mode_owner_ok() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_admin/members/user_private001/approve")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.participants_count").exists());
    }

    @Test
    void approve_members_mode_by_member_ok() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_appr/members/user_zoe001/approve")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }

    @Test
    void reject_non_owner_non_platform_admin_forbidden() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_reject/members/user_private001/reject")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden());
    }

    @Test
    void reject_owner_ok() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_s27_reject/members/user_private001/reject")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));
    }

    @Test
    void membership_without_token_returns401() throws Exception {
        mockMvc.perform(post("/api/tag-points/tp_001/join").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}
