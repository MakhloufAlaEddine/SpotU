package com.spotu.modules.subscriptions.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import com.spotu.modules.payments.stripe.StripeSubscriptionService;
import com.stripe.exception.InvalidRequestException;
import com.stripe.model.checkout.Session;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class SubscriptionIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private StripeSubscriptionService stripeSubscriptionService;

    @Test
    void subscriptionPlans_public_ordered() throws Exception {
        mockMvc.perform(get("/api/subscription-plans").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].plan_id", is("plan_s21_active")));
    }

    @Test
    void subscribe_withoutAuth_returns401() throws Exception {
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_active\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void subscribe_planNotFound_returns404() throws Exception {
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_inexistant\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Plan introuvable")));
    }

    @Test
    void subscribe_planInactive_returns400() throws Exception {
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_inactive\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Ce plan n'est plus disponible à la souscription.")));
    }

    @Test
    void subscribe_missingPlanId_returns400() throws Exception {
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("plan_id requis")));
    }

    @Test
    void subscribe_badDuration_returns400() throws Exception {
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_90d\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", containsString("duration_days=90")));
    }

    @Test
    void subscribe_zeroPrice_returns400() throws Exception {
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_free\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Le montant du plan doit être supérieur à 0.")));
    }

    @Test
    void subscribe_conflict_returns409() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL, 'code', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """,
                "sub_block_zoe", "user_zoe001", "plan_s21_active"
        );
        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_active\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", containsString("Vous avez déjà un abonnement active")));
    }

    @Test
    void subscribe_past_due_doesNotBlock_returns200() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES (?, ?, ?, 'past_due', CURRENT_TIMESTAMP, NULL, 'code', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """,
                "sub_past_zoe", "user_zoe001", "plan_s21_active"
        );
        Session session = org.mockito.Mockito.mock(Session.class);
        when(session.getUrl()).thenReturn("https://checkout.stripe.com/c/pay/cs_test");
        when(session.getId()).thenReturn("cs_test_subscribe_pd");
        when(stripeSubscriptionService.getOrCreateCustomer(anyString(), anyString(), anyString()))
                .thenReturn("cus_zoe");
        when(stripeSubscriptionService.ensureSubscriptionPrice(
                anyString(), anyString(), any(), anyLong(), anyString(), anyInt()
        )).thenReturn(new String[]{"prod_x", "price_y"});
        when(stripeSubscriptionService.createSubscriptionCheckoutSession(
                anyString(), anyString(), anyString(), anyString(), anyMap(), startsWith("user_zoe001_plan_s21_active_")
        )).thenReturn(session);

        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_active\",\"origin_url\":\"https://app.example\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session_id", is("cs_test_subscribe_pd")))
                .andExpect(jsonPath("$.plan_id", is("plan_s21_active")));
    }

    @Test
    void subscribe_nominal_callsStripeWithIdempotencyWindow() throws Exception {
        Session session = org.mockito.Mockito.mock(Session.class);
        when(session.getUrl()).thenReturn("https://checkout.stripe.com/c/pay/cs_nominal");
        when(session.getId()).thenReturn("cs_nominal");
        when(stripeSubscriptionService.getOrCreateCustomer(eq("user_zoe001"), anyString(), anyString()))
                .thenReturn("cus_zoe_nominal");
        when(stripeSubscriptionService.ensureSubscriptionPrice(
                eq("plan_s21_active"), anyString(), any(), eq(1999L), eq("EUR"), eq(30)
        )).thenReturn(new String[]{"prod_nom", "price_nom"});
        when(stripeSubscriptionService.createSubscriptionCheckoutSession(
                eq("cus_zoe_nominal"),
                eq("price_nom"),
                eq("https://app.example/subscription-success?session_id={CHECKOUT_SESSION_ID}"),
                eq("https://app.example/subscription-plans"),
                anyMap(),
                startsWith("user_zoe001_plan_s21_active_")
        )).thenReturn(session);

        mockMvc.perform(post("/api/subscriptions/subscribe")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"plan_id\":\"plan_s21_active\",\"origin_url\":\"https://app.example\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url", is("https://checkout.stripe.com/c/pay/cs_nominal")));

        verify(stripeSubscriptionService).createSubscriptionCheckoutSession(
                eq("cus_zoe_nominal"),
                eq("price_nom"),
                eq("https://app.example/subscription-success?session_id={CHECKOUT_SESSION_ID}"),
                eq("https://app.example/subscription-plans"),
                anyMap(),
                startsWith("user_zoe001_plan_s21_active_")
        );
    }

    @Test
    void me_noSubscription_returnsHasSubscriptionFalse() throws Exception {
        mockMvc.perform(get("/api/subscriptions/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.has_subscription", is(false)))
                .andExpect(jsonPath("$.subscription").value(nullValue()));
    }

    @Test
    void me_withSubscription_deserializesBenefitsSnapshot() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL, 'code', 'sub_stripe_x',
                        ? , CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """,
                "sub_me_zoe",
                "user_zoe001",
                "plan_s21_active",
                "{\"plan_id\":\"plan_s21_active\",\"exempt_payer_fixed\":true}"
        );
        mockMvc.perform(get("/api/subscriptions/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.has_subscription", is(true)))
                .andExpect(jsonPath("$.subscription.subscription_id", is("sub_me_zoe")))
                .andExpect(jsonPath("$.subscription.benefits_snapshot.plan_id", is("plan_s21_active")))
                .andExpect(jsonPath("$.subscription.benefits_snapshot.exempt_payer_fixed", is(true)));
    }

    @Test
    void history_empty_returns200EmptyArray() throws Exception {
        mockMvc.perform(get("/api/subscriptions/history")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void history_returnsRowsOrdered() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES ('sub_hist_old', 'user_zoe001', 'plan_s21_active', 'cancelled',
                        TIMESTAMP WITH TIME ZONE '2025-01-01 00:00:00+00:00', NULL, 'c', NULL, NULL,
                        TIMESTAMP WITH TIME ZONE '2025-01-01 00:00:00+00:00', CURRENT_TIMESTAMP)
                        """
        );
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES ('sub_hist_new', 'user_zoe001', 'plan_s21_active', 'active',
                        TIMESTAMP WITH TIME ZONE '2026-02-01 00:00:00+00:00', NULL, 'c', NULL, NULL,
                        TIMESTAMP WITH TIME ZONE '2026-02-02 00:00:00+00:00', CURRENT_TIMESTAMP)
                        """
        );
        mockMvc.perform(get("/api/subscriptions/history")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", is(2)))
                .andExpect(jsonPath("$[0].subscription_id", is("sub_hist_new")))
                .andExpect(jsonPath("$[1].subscription_id", is("sub_hist_old")));
    }

    @Test
    void checkoutStatus_customerMismatch_returns403() throws Exception {
        jdbcTemplate.update("UPDATE users SET stripe_customer_id = ? WHERE user_id = ?", "cus_mine", "user_private001");
        Session session = org.mockito.Mockito.mock(Session.class);
        when(session.getCustomer()).thenReturn("cus_other");
        when(session.getStatus()).thenReturn("complete");
        when(session.getSubscription()).thenReturn("sub_x");
        when(session.getMetadata()).thenReturn(java.util.Map.of("user_id", "user_private001"));
        when(stripeSubscriptionService.retrieveCheckoutSession("cs_mismatch")).thenReturn(session);

        mockMvc.perform(get("/api/subscriptions/checkout/status/cs_mismatch")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Accès refusé")));
    }

    @Test
    void checkoutStatus_adminBypass_returns200() throws Exception {
        Session session = org.mockito.Mockito.mock(Session.class);
        when(session.getCustomer()).thenReturn("cus_other");
        when(session.getStatus()).thenReturn("open");
        when(session.getSubscription()).thenReturn(null);
        when(session.getMetadata()).thenReturn(java.util.Map.of());
        when(stripeSubscriptionService.retrieveCheckoutSession("cs_admin")).thenReturn(session);

        mockMvc.perform(get("/api/subscriptions/checkout/status/cs_admin")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session_status", is("open")))
                .andExpect(jsonPath("$.local_sub_id").value(nullValue()));
    }

    @Test
    void checkoutStatus_stripeNotFound_returns404() throws Exception {
        when(stripeSubscriptionService.retrieveCheckoutSession("cs_missing"))
                .thenThrow(new InvalidRequestException(
                        "no such checkout", "session", "resource_missing", null, 404, null));

        mockMvc.perform(get("/api/subscriptions/checkout/status/cs_missing")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", containsString("Session introuvable")));
    }

    @Test
    void checkoutStatus_matchesCustomer_returns200WithLocal() throws Exception {
        jdbcTemplate.update("UPDATE users SET stripe_customer_id = ? WHERE user_id = ?", "cus_mine", "user_private001");
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES ('sub_local', 'user_private001', 'plan_s21_active', 'active', CURRENT_TIMESTAMP, NULL,
                        'c', 'sub_stripe_match', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """
        );
        Session session = org.mockito.Mockito.mock(Session.class);
        when(session.getCustomer()).thenReturn("cus_mine");
        when(session.getStatus()).thenReturn("complete");
        when(session.getSubscription()).thenReturn("sub_stripe_match");
        when(session.getMetadata()).thenReturn(java.util.Map.of("plan_id", "plan_s21_active"));
        when(stripeSubscriptionService.retrieveCheckoutSession("cs_ok")).thenReturn(session);

        mockMvc.perform(get("/api/subscriptions/checkout/status/cs_ok")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.stripe_sub_id", is("sub_stripe_match")))
                .andExpect(jsonPath("$.local_sub_id", is("sub_local")))
                .andExpect(jsonPath("$.local_status", is("active")));
    }

    @Test
    void cancel_immediate_nonAdmin_returns403() throws Exception {
        mockMvc.perform(post("/api/subscriptions/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"immediate\":true}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void cancel_noActive_returns404() throws Exception {
        mockMvc.perform(post("/api/subscriptions/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Aucun abonnement actif à annuler")));
    }

    @Test
    void cancel_invalidJsonBody_defaultsImmediateFalse() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES ('sub_cancel_badjson', 'user_private001', 'plan_s21_active', 'active',
                        CURRENT_TIMESTAMP, NULL, 'c', 'sub_stripe_cancel', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """
        );
        mockMvc.perform(post("/api/subscriptions/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{not json"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelling")));

        String status = jdbcTemplate.queryForObject(
                "SELECT status FROM user_subscriptions WHERE subscription_id = ?",
                String.class,
                "sub_cancel_badjson"
        );
        assertThat(status).isEqualTo("cancelling");
    }

    @Test
    void cancel_stripeFailure_stillUpdatesDb() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES ('sub_cancel_fail', 'user_private001', 'plan_s21_active', 'active',
                        CURRENT_TIMESTAMP, NULL, 'c', 'sub_stripe_fail', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """
        );
        org.mockito.Mockito.doThrow(new RuntimeException("stripe down"))
                .when(stripeSubscriptionService)
                .cancelStripeSubscription(eq("sub_stripe_fail"), eq(true));

        mockMvc.perform(post("/api/subscriptions/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)));

        String status = jdbcTemplate.queryForObject(
                "SELECT status FROM user_subscriptions WHERE subscription_id = ?",
                String.class,
                "sub_cancel_fail"
        );
        assertThat(status).isEqualTo("cancelling");
    }

    @Test
    void cancel_withoutStripeId_skipsStripeCall() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions (
                            subscription_id, user_id, plan_id, status, started_at, expires_at,
                            plan_code, stripe_subscription_id, benefits_snapshot, created_at, updated_at
                        ) VALUES ('sub_cancel_nostripe', 'user_private001', 'plan_s21_active', 'active',
                        CURRENT_TIMESTAMP, NULL, 'c', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """
        );
        mockMvc.perform(post("/api/subscriptions/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        verify(stripeSubscriptionService, org.mockito.Mockito.never()).cancelStripeSubscription(anyString(), anyBoolean());
    }
}
