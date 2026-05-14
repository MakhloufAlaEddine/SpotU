package com.spotu.modules.payments.api;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class StripeWebhookIntegrationTest {

    private static final String WEBHOOK_SECRET = "whsec_test_secret";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void webhook_signatureValide_andCheckoutRequested_setsAuthorized() throws Exception {
        String payload = """
                {"id":"evt_webhook_001","type":"checkout.session.completed","data":{"object":{"id":"cs_webhook_030","mode":"payment","payment_status":"unpaid","metadata":{"payment_id":"pay_012","booking_id":"booking_030"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_012'", String.class);
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_030'", String.class);
        String eventStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM stripe_webhook_events WHERE event_id='evt_webhook_001'", String.class);

        Assertions.assertEquals("authorized", paymentStatus);
        Assertions.assertEquals("requested", bookingStatus);
        Assertions.assertEquals("success", eventStatus);
    }

    @Test
    void webhook_signatureInvalide_returns400_andDoesNotPersistEvent() throws Exception {
        String payload = """
                {"id":"evt_webhook_002","type":"checkout.session.completed","data":{"object":{"id":"cs_webhook_031","mode":"payment","payment_status":"unpaid","metadata":{"payment_id":"pay_013","booking_id":"booking_031"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", "t=1,v1=invalid")
                        .content(payload))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", startsWith("Signature invalide : ")));

        Integer eventCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM stripe_webhook_events WHERE event_id='evt_webhook_002'", Integer.class);
        Assertions.assertEquals(0, eventCount);
    }

    @Test
    void webhook_bodyJsonInvalide_withSecret_returns400() throws Exception {
        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader("{\"id\":\"evt_bad_json\"}", WEBHOOK_SECRET))
                        .content("not-json"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void webhook_eventIdOrTypeMissing_returns400() throws Exception {
        String missingType = """
                {"id":"evt_missing_type","data":{"object":{"id":"pi_x"}}}
                """;
        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(missingType, WEBHOOK_SECRET))
                        .content(missingType))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("event id/type manquant")));

        String missingId = """
                {"type":"payment_intent.succeeded","data":{"object":{"id":"pi_x"}}}
                """;
        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(missingId, WEBHOOK_SECRET))
                        .content(missingId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("event id/type manquant")));
    }

    @Test
    void webhook_eventDejaVu_idempotentSkip() throws Exception {
        String payload = """
                {"id":"evt_webhook_003","type":"payment_intent.succeeded","data":{"object":{"id":"pi_webhook_031","latest_charge":"ch_webhook_031","metadata":{"payment_id":"pay_013","booking_id":"booking_031"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)))
                .andExpect(jsonPath("$.idempotent_skip", is(true)));
    }

    @Test
    void webhook_checkoutAwaitingPayment_setsCapturedAndConfirmed() throws Exception {
        String payload = """
                {"id":"evt_webhook_004","type":"checkout.session.completed","data":{"object":{"id":"cs_webhook_031","mode":"payment","payment_status":"unpaid","metadata":{"payment_id":"pay_013","booking_id":"booking_031"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_013'", String.class);
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_031'", String.class);
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_031'", String.class);

        Assertions.assertEquals("captured", paymentStatus);
        Assertions.assertEquals("confirmed", bookingStatus);
        Assertions.assertEquals("paid", bookingPaymentStatus);
    }

    @Test
    void webhook_checkoutSubscription_incompleteMetadata_doesNotTouchPayment() throws Exception {
        String payload = """
                {"id":"evt_webhook_005","type":"checkout.session.completed","data":{"object":{"id":"cs_sub_001","mode":"subscription","payment_status":"unpaid","metadata":{"payment_id":"pay_012","booking_id":"booking_030"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_012'", String.class);
        Assertions.assertEquals("requires_authorization", paymentStatus);
        Integer subRows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM user_subscriptions WHERE stripe_subscription_id IS NOT NULL", Integer.class);
        Assertions.assertEquals(0, subRows);
    }

    @Test
    void webhook_checkoutSubscription_fullMetadata_insertsSubscriptionAndNotification() throws Exception {
        String payload = """
                {"id":"evt_webhook_sub_cs","type":"checkout.session.completed","data":{"object":{"id":"cs_sub_full_01","mode":"subscription","subscription":"sub_stripe_wh_01","metadata":{"plan_id":"plan_webhook_sub","user_id":"user_private001","product_type":"subscription"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String internalSubId = jdbcTemplate.queryForObject(
                "SELECT subscription_id FROM user_subscriptions WHERE stripe_subscription_id='sub_stripe_wh_01'",
                String.class);
        Assertions.assertTrue(internalSubId != null && internalSubId.startsWith("sub_"));

        String related = jdbcTemplate.queryForObject(
                "SELECT related_id FROM stripe_webhook_events WHERE event_id='evt_webhook_sub_cs'", String.class);
        Assertions.assertEquals(internalSubId, related);

        Integer notifCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id='user_private001' AND type='subscription_activated'",
                Integer.class);
        Assertions.assertEquals(1, notifCount);
    }

    @Test
    void webhook_dualRouting_checkoutPaymentStillRunsWhenNotSubscriptionMode() throws Exception {
        String payload = """
                {"id":"evt_webhook_dual_pay","type":"checkout.session.completed","data":{"object":{"id":"cs_webhook_031","mode":"payment","payment_status":"unpaid","metadata":{"payment_id":"pay_013","booking_id":"booking_031"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_013'", String.class);
        Assertions.assertEquals("captured", paymentStatus);
    }

    @Test
    void webhook_subscriptionDeleted_updatesWithoutCancelledGuard() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions
                        (subscription_id, user_id, plan_id, status, stripe_subscription_id, benefits_snapshot, updated_at)
                        VALUES ('sub_row_del', 'user_private001', 'plan_webhook_sub', 'cancelled', 'sub_stripe_del_01', '{}', CURRENT_TIMESTAMP)
                        """);

        String payload = """
                {"id":"evt_webhook_sub_del","type":"customer.subscription.deleted","data":{"object":{"id":"sub_stripe_del_01"}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String status = jdbcTemplate.queryForObject(
                "SELECT status FROM user_subscriptions WHERE subscription_id='sub_row_del'", String.class);
        Assertions.assertEquals("cancelled", status);
        Assertions.assertNotNull(jdbcTemplate.queryForObject(
                "SELECT cancelled_at FROM user_subscriptions WHERE subscription_id='sub_row_del'", Object.class));
    }

    @Test
    void webhook_invoicePaid_renewsAndSetsActive() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions
                        (subscription_id, user_id, plan_id, status, stripe_subscription_id, benefits_snapshot, updated_at)
                        VALUES ('sub_row_inv', 'user_private001', 'plan_webhook_sub', 'past_due', 'sub_stripe_inv_01', '{}', CURRENT_TIMESTAMP)
                        """);

        long periodEnd = Instant.now().getEpochSecond() + 86400 * 30;
        String payload = """
                {"id":"evt_webhook_inv_paid","type":"invoice.paid","data":{"object":{"subscription":"sub_stripe_inv_01","lines":{"data":[{"period":{"end":%d}}]}}}}
                """.formatted(periodEnd);

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String st = jdbcTemplate.queryForObject(
                "SELECT status FROM user_subscriptions WHERE subscription_id='sub_row_inv'", String.class);
        Assertions.assertEquals("active", st);
    }

    @Test
    void webhook_subscriptionUpdated_toCancelling_insertsNotification() throws Exception {
        jdbcTemplate.update(
                """
                        INSERT INTO user_subscriptions
                        (subscription_id, user_id, plan_id, status, stripe_subscription_id, benefits_snapshot, updated_at)
                        VALUES ('sub_row_upd', 'user_private001', 'plan_webhook_sub', 'active', 'sub_stripe_upd_01', '{}', CURRENT_TIMESTAMP)
                        """);

        long periodEnd = Instant.now().getEpochSecond() + 86400 * 7;
        String payload = """
                {"id":"evt_webhook_sub_upd","type":"customer.subscription.updated","data":{"object":{"id":"sub_stripe_upd_01","status":"active","cancel_at_period_end":true,"current_period_end":%d}}}
                """.formatted(periodEnd);

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String st = jdbcTemplate.queryForObject(
                "SELECT status FROM user_subscriptions WHERE subscription_id='sub_row_upd'", String.class);
        Assertions.assertEquals("cancelling", st);
        Integer n = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id='user_private001' AND type='subscription_cancelling'",
                Integer.class);
        Assertions.assertEquals(1, n);
    }

    @Test
    void webhook_eventInconnu_returns200() throws Exception {
        String payload = """
                {"id":"evt_webhook_006","type":"customer.created","data":{"object":{"id":"cus_001"}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));
    }

    @Test
    void webhook_paymentIntentAmountCapturableUpdated_setsAuthorizedAndReceiverNotif() throws Exception {
        String payload = """
                {"id":"evt_webhook_007","type":"payment_intent.amount_capturable_updated","data":{"object":{"id":"pi_s30","amount_capturable":4000,"metadata":{"payment_id":"pay_s30_awaiting","booking_id":"booking_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        Assertions.assertEquals("authorized", paymentStatus);

        String notifBody = jdbcTemplate.queryForObject(
                """
                        SELECT body FROM notifications
                        WHERE user_id='user_admin001' AND type='payment_authorized'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                String.class
        );
        Assertions.assertEquals("Le paiement pour votre prestation est confirmé — vous pouvez procéder.", notifBody);
    }

    @Test
    void webhook_paymentIntentFailed_setsFailedAndPayerOnlyNotif() throws Exception {
        String payload = """
                {"id":"evt_webhook_008","type":"payment_intent.payment_failed","data":{"object":{"id":"pi_s30","metadata":{"payment_id":"pay_s30_awaiting","booking_id":"booking_s30_awaiting"},"last_payment_error":{"code":"card_declined"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        Assertions.assertEquals("failed", paymentStatus);

        Integer payerNotif = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id='user_private001' AND type='payment_failed'",
                Integer.class);
        Integer receiverNotif = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE user_id='user_admin001' AND type='payment_failed'",
                Integer.class);
        Assertions.assertEquals(1, payerNotif);
        Assertions.assertEquals(0, receiverNotif);
    }

    @Test
    void webhook_paymentIntentCanceled_setsCancelledWithoutNotif() throws Exception {
        Integer beforeNotif = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM notifications", Integer.class);
        String payload = """
                {"id":"evt_webhook_009","type":"payment_intent.canceled","data":{"object":{"id":"pi_s30","metadata":{"payment_id":"pay_s30_awaiting","booking_id":"booking_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        Assertions.assertEquals("cancelled", paymentStatus);

        Integer afterNotif = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM notifications", Integer.class);
        Assertions.assertEquals(beforeNotif, afterNotif);
    }

    @Test
    void webhook_checkoutPaid_usesBranchCNotificationLabelWithoutABientot() throws Exception {
        String payload = """
                {"id":"evt_webhook_010","type":"checkout.session.completed","data":{"object":{"id":"cs_s30","mode":"payment","payment_status":"paid","metadata":{"payment_id":"pay_s30_awaiting","booking_id":"booking_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String payerBody = jdbcTemplate.queryForObject(
                """
                        SELECT body FROM notifications
                        WHERE user_id='user_private001' AND type='booking_confirmed'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                String.class
        );
        Assertions.assertEquals("Votre réservation pour « Service Admin » est confirmée.", payerBody);
    }

    @Test
    void webhook_paymentIntentSucceeded_receiverLabelUsesCaptureWording() throws Exception {
        String payload = """
                {"id":"evt_webhook_011","type":"payment_intent.succeeded","data":{"object":{"id":"pi_s30","latest_charge":"ch_new_030","metadata":{"payment_id":"pay_s30_awaiting","booking_id":"booking_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String receiverBody = jdbcTemplate.queryForObject(
                """
                        SELECT body FROM notifications
                        WHERE user_id='user_admin001' AND type='booking_confirmed'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                String.class
        );
        Assertions.assertEquals("Paiement capturé pour « Service Admin ». Votre planning a été mis à jour.", receiverBody);
    }

    @Test
    void webhook_resolverMetadataHasPriorityOverPaymentIntentLookup() throws Exception {
        String payload = """
                {"id":"evt_webhook_012","type":"payment_intent.succeeded","data":{"object":{"id":"pi_webhook_031","latest_charge":"ch_meta_priority","metadata":{"payment_id":"pay_s30_awaiting","booking_id":"booking_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String pay012Status = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String pay013Status = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_013'", String.class);
        Assertions.assertEquals("captured", pay012Status);
        Assertions.assertEquals("requires_authorization", pay013Status);
    }

    @Test
    void webhook_chargeRefunded_full_updatesPaymentAndNotifiesPayer() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='captured', stripe_charge_id='ch_existing_001' WHERE payment_id='pay_s30_awaiting'");
        String payload = """
                {"id":"evt_webhook_013","type":"charge.refunded","data":{"object":{"id":"ch_new_001","amount_refunded":5225,"refunded":true,"metadata":{"payment_id":"pay_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String refundStatus = jdbcTemplate.queryForObject(
                "SELECT refund_status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String chargeId = jdbcTemplate.queryForObject(
                "SELECT stripe_charge_id FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        Double refundAmount = jdbcTemplate.queryForObject(
                "SELECT refund_amount FROM payments WHERE payment_id='pay_s30_awaiting'", Double.class);
        String body = jdbcTemplate.queryForObject(
                """
                        SELECT body FROM notifications
                        WHERE user_id='user_private001' AND type='payment_refunded'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """, String.class);

        Assertions.assertEquals("refunded", paymentStatus);
        Assertions.assertEquals("succeeded", refundStatus);
        Assertions.assertEquals("ch_existing_001", chargeId);
        Assertions.assertEquals(52.25d, refundAmount);
        Assertions.assertEquals("Vous avez été remboursé de 52.25 €.", body);
    }

    @Test
    void webhook_chargeRefunded_partial_setsPartiallyRefunded() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='captured', stripe_charge_id=NULL WHERE payment_id='pay_s30_awaiting'");
        String payload = """
                {"id":"evt_webhook_014","type":"charge.refunded","data":{"object":{"id":"ch_partial_001","amount_refunded":2000,"refunded":false,"metadata":{"payment_id":"pay_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String chargeId = jdbcTemplate.queryForObject(
                "SELECT stripe_charge_id FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String notifTitle = jdbcTemplate.queryForObject(
                """
                        SELECT title FROM notifications
                        WHERE user_id='user_private001' AND type='payment_refunded'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """, String.class);
        Assertions.assertEquals("partially_refunded", paymentStatus);
        Assertions.assertEquals("ch_partial_001", chargeId);
        Assertions.assertEquals("Remboursement partiel", notifTitle);
    }

    @Test
    void webhook_refundUpdated_phase1_fullRefund_setsRefundedWithoutNotification() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='captured', stripe_charge_id='edge_001', refund_status=NULL, refund_amount=NULL WHERE payment_id='pay_s30_awaiting'");
        Integer beforeNotif = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='payment_refunded' AND user_id='user_private001'",
                Integer.class);
        String payload = """
                {"id":"evt_webhook_015","type":"refund.updated","data":{"object":{"id":"re_edge_001","status":"succeeded","charge":"edge_001","amount":5225}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String refundStatus = jdbcTemplate.queryForObject(
                "SELECT refund_status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        Double refundAmount = jdbcTemplate.queryForObject(
                "SELECT refund_amount FROM payments WHERE payment_id='pay_s30_awaiting'", Double.class);
        Integer afterNotif = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='payment_refunded' AND user_id='user_private001'",
                Integer.class);
        Assertions.assertEquals("refunded", paymentStatus);
        Assertions.assertEquals("succeeded", refundStatus);
        Assertions.assertEquals(52.25d, refundAmount);
        Assertions.assertEquals(beforeNotif, afterNotif);
    }

    @Test
    void webhook_refundUpdated_phase2_updatesOnlyRefundStatus() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='captured', stripe_charge_id='sync_001', refund_status=NULL, refund_amount=NULL WHERE payment_id='pay_s30_awaiting'");
        String payload = """
                {"id":"evt_webhook_016","type":"refund.updated","data":{"object":{"id":"re_sync_001","status":"failed","charge":"sync_001","amount":2000}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        String refundStatus = jdbcTemplate.queryForObject(
                "SELECT refund_status FROM payments WHERE payment_id='pay_s30_awaiting'", String.class);
        Assertions.assertEquals("captured", paymentStatus);
        Assertions.assertEquals("failed", refundStatus);
    }

    @Test
    void webhook_chargeRefunded_missingPayment_skipsGracefully() throws Exception {
        String payload = """
                {"id":"evt_webhook_017","type":"charge.refunded","data":{"object":{"id":"ch_missing_001","amount_refunded":1000,"refunded":true,"metadata":{}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));
    }

    @Test
    void webhook_chargeRefunded_duplicateEventId_idempotentSkip() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='captured', stripe_charge_id='ch_dup_001' WHERE payment_id='pay_s30_awaiting'");
        String payload = """
                {"id":"evt_webhook_018","type":"charge.refunded","data":{"object":{"id":"ch_dup_001","amount_refunded":5225,"refunded":true,"metadata":{"payment_id":"pay_s30_awaiting"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.received", is(true)));

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signature)
                        .content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotent_skip", is(true)));
    }

    @Test
    void webhook_chargeRefunded_doesNotUpdateBooking() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='captured', stripe_charge_id='ch_nobook_001' WHERE payment_id='pay_s30_awaiting'");
        String beforeBookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_s30_awaiting'", String.class);
        String payload = """
                {"id":"evt_webhook_019","type":"charge.refunded","data":{"object":{"id":"ch_nobook_001","amount_refunded":5225,"refunded":true,"metadata":{"payment_id":"pay_s30_awaiting"}}}}
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload, WEBHOOK_SECRET))
                        .content(payload))
                .andExpect(status().isOk());

        String afterBookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_s30_awaiting'", String.class);
        Assertions.assertEquals(beforeBookingStatus, afterBookingStatus);
    }

    private static String signedHeader(String payload, String secret) {
        String timestamp = String.valueOf(Instant.now().getEpochSecond());
        String toSign = timestamp + "." + payload;
        String signature = hmacSha256Hex(secret, toSign);
        return "t=" + timestamp + ",v1=" + signature;
    }

    private static String hmacSha256Hex(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception exc) {
            throw new IllegalStateException(exc);
        }
    }
}
