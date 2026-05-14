package com.spotu.modules.subscriptions.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import com.spotu.modules.payments.stripe.StripeSubscriptionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AdminSubscriptionIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private StripeSubscriptionService stripeSubscriptionService;

    @Test
    void listPlans_nonAdmin_returns403() throws Exception {
        mockMvc.perform(get("/api/admin/subscription-plans")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Requires admin role")));
    }

    @Test
    void listPlans_admin_returns200IncludingInactivePlans() throws Exception {
        mockMvc.perform(get("/api/admin/subscription-plans")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("plan_s21_inactive")))
                .andExpect(content().string(containsString("plan_s21_active")));
    }

    @Test
    void createPlan_missingName_returns400() throws Exception {
        mockMvc.perform(post("/api/admin/subscription-plans")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"price\":1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("name is required")));
    }

    @Test
    void createPlan_minimal_returns200() throws Exception {
        mockMvc.perform(post("/api/admin/subscription-plans")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Plan Admin Test\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("Plan Admin Test")))
                .andExpect(jsonPath("$.price", is(0.0)))
                .andExpect(jsonPath("$.active", is(true)))
                .andExpect(jsonPath("$.priority", is(0)))
                .andExpect(jsonPath("$.plan_id", containsString("plan_")));
    }

    @Test
    void updatePlan_notFound_returns404() throws Exception {
        mockMvc.perform(put("/api/admin/subscription-plans/plan_nope_xyz")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"X\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Plan not found")));
    }

    @Test
    void updatePlan_noValidFields_returns400() throws Exception {
        mockMvc.perform(put("/api/admin/subscription-plans/plan_s21_active")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"stripe_product_id\":\"prod_hack\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("No valid fields to update")));
    }

    @Test
    void updatePlan_partial_returns200() throws Exception {
        mockMvc.perform(put("/api/admin/subscription-plans/plan_s21_active")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"priority\":42,\"unknown\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));

        int p = jdbcTemplate.queryForObject(
                "SELECT priority FROM subscription_plans WHERE plan_id = ?",
                Integer.class,
                "plan_s21_active"
        );
        org.assertj.core.api.Assertions.assertThat(p).isEqualTo(42);
    }

    @Test
    void deletePlan_missing_returns200() throws Exception {
        mockMvc.perform(delete("/api/admin/subscription-plans/plan_never_created_zzzz")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));
    }

    @Test
    void deletePlan_referenced_returns409() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO subscription_plans (
                            plan_id, name, description, price, duration_days,
                            exempt_payer_fixed, exempt_payer_percent, exempt_receiver_fixed, exempt_receiver_percent,
                            active, priority, created_at, updated_at
                        ) VALUES (
                            'plan_fk_delete_test', 'FK test', NULL, 1.00, 30,
                            FALSE, FALSE, FALSE, FALSE, TRUE, 0,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        """
        );
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, plan_code,
                            stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES (
                            'sub_fk_block', 'user_zoe001', 'plan_fk_delete_test', 'active', 'c',
                            NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        """
        );
        mockMvc.perform(delete("/api/admin/subscription-plans/plan_fk_delete_test")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", containsString("abonnements existants")));
    }

    @Test
    void listSubscriptions_admin_returns200() throws Exception {
        mockMvc.perform(get("/api/admin/subscriptions")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }

    @Test
    void adminCancel_notFound_returns404() throws Exception {
        mockMvc.perform(post("/api/admin/subscriptions/sub_nope_xyz/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Abonnement introuvable")));
    }

    @Test
    void adminCancel_nominal_returnsSuccessAndStatusOnly() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, plan_code,
                            stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES (
                            'sub_admin_cancel_1', 'user_zoe001', 'plan_s21_active', 'active', 'c',
                            'sub_stripe_admin_1', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        """
        );
        MvcResult cancelResult = mockMvc.perform(post("/api/admin/subscriptions/sub_admin_cancel_1/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("cancelling")))
                .andReturn();

        org.assertj.core.api.Assertions.assertThat(cancelResult.getResponse().getContentAsString())
                .doesNotContain("\"subscription_id\"");

        verify(stripeSubscriptionService).cancelStripeSubscription(eq("sub_stripe_admin_1"), eq(true));
    }

    @Test
    void adminCancel_immediate_callsStripeWithAtPeriodEndFalse() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, plan_code,
                            stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES (
                            'sub_admin_cancel_2', 'user_zoe001', 'plan_s21_active', 'active', 'c',
                            'sub_stripe_admin_2', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                        )
                        """
        );
        mockMvc.perform(post("/api/admin/subscriptions/sub_admin_cancel_2/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"immediate\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelled")));

        verify(stripeSubscriptionService).cancelStripeSubscription(eq("sub_stripe_admin_2"), eq(false));
    }
}
