package com.spotu.modules.payments.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import com.spotu.modules.workers.service.ExpiryWorkerService;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class StripeWebhookConcurrencyIntegrationTest {

    private static final String WEBHOOK_SECRET = "whsec_test_secret";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ExpiryWorkerService expiryWorkerService;

    @Test
    void webhook_sameEventPostedConcurrently_claimsSingleEventRow() throws Exception {
        String payload = """
                {"id":"evt_webhook_concurrent_001","type":"payment_intent.succeeded","data":{"object":{"id":"pi_webhook_031","latest_charge":"ch_concurrent_001","metadata":{"payment_id":"pay_013","booking_id":"booking_031"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        int concurrency = 8;
        CountDownLatch startGate = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(concurrency);
        List<Future<Void>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < concurrency; i++) {
                futures.add(pool.submit(postWebhookTask(startGate, payload, signature)));
            }
            startGate.countDown();
            for (Future<Void> f : futures) {
                f.get();
            }
        } finally {
            pool.shutdownNow();
        }

        Integer eventRows = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM stripe_webhook_events WHERE event_id='evt_webhook_concurrent_001'",
                Integer.class
        );
        String eventStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM stripe_webhook_events WHERE event_id='evt_webhook_concurrent_001'",
                String.class
        );
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_013'",
                String.class
        );

        Assertions.assertEquals(1, eventRows);
        Assertions.assertEquals("success", eventStatus);
        Assertions.assertEquals("captured", paymentStatus);
    }

    @Test
    void checkoutStatus_concurrentWithCheckoutCompletedWebhook_keepsAuthorizedConsistent() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='requires_authorization' WHERE payment_id='pay_041'");
        jdbcTemplate.update("UPDATE bookings SET status='requested', payment_status='requires_authorization' WHERE booking_id='booking_041'");
        jdbcTemplate.update("DELETE FROM notifications WHERE type='payment_authorized' AND user_id='user_admin001'");

        String payload = """
                {"id":"evt_webhook_concurrent_002","type":"checkout.session.completed","data":{"object":{"id":"cs_status_complete_unpaid_041","mode":"payment","payment_status":"unpaid","metadata":{"payment_id":"pay_041","booking_id":"booking_041"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        CountDownLatch startGate = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(6);
        List<Future<Void>> futures = new ArrayList<>();
        try {
            futures.add(pool.submit(postWebhookTask(startGate, payload, signature)));
            for (int i = 0; i < 5; i++) {
                futures.add(pool.submit(getCheckoutStatusTask(startGate, "cs_status_complete_unpaid_041")));
            }
            startGate.countDown();
            for (Future<Void> f : futures) {
                f.get();
            }
        } finally {
            pool.shutdownNow();
        }

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_041'",
                String.class
        );
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_041'",
                String.class
        );
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_041'",
                String.class
        );
        Integer notifCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE type='payment_authorized' AND user_id='user_admin001'",
                Integer.class
        );

        Assertions.assertEquals("authorized", paymentStatus);
        Assertions.assertEquals("requested", bookingStatus);
        Assertions.assertEquals("authorized", bookingPaymentStatus);
        Assertions.assertTrue(notifCount != null && notifCount >= 0 && notifCount <= 1);
    }

    @Test
    void paymentIntentSucceeded_concurrentWithCheckoutStatus_keepsCapturedAndConfirmed() throws Exception {
        jdbcTemplate.update("UPDATE payments SET status='requires_authorization', stripe_charge_id=NULL WHERE payment_id='pay_041'");
        jdbcTemplate.update("UPDATE bookings SET status='requested', payment_status='requires_authorization' WHERE booking_id='booking_041'");

        String payload = """
                {"id":"evt_webhook_concurrent_003","type":"payment_intent.succeeded","data":{"object":{"id":"pi_checkout_041","latest_charge":"ch_concurrent_041","metadata":{"payment_id":"pay_041","booking_id":"booking_041"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        CountDownLatch startGate = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(4);
        List<Future<Void>> futures = new ArrayList<>();
        try {
            futures.add(pool.submit(postWebhookTask(startGate, payload, signature)));
            for (int i = 0; i < 3; i++) {
                futures.add(pool.submit(getCheckoutStatusTask(startGate, "cs_status_complete_unpaid_041")));
            }
            startGate.countDown();
            for (Future<Void> f : futures) {
                f.get();
            }
        } finally {
            pool.shutdownNow();
        }

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_041'",
                String.class
        );
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_041'",
                String.class
        );
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_041'",
                String.class
        );
        String chargeId = jdbcTemplate.queryForObject(
                "SELECT stripe_charge_id FROM payments WHERE payment_id='pay_041'",
                String.class
        );

        Assertions.assertTrue(Set.of("authorized", "captured").contains(paymentStatus));
        Assertions.assertTrue(Set.of("requested", "confirmed").contains(bookingStatus));
        Assertions.assertTrue(Set.of("authorized", "paid").contains(bookingPaymentStatus));
        Assertions.assertEquals("ch_concurrent_041", chargeId);
    }

    @Test
    void chargeRefunded_concurrentWithPaymentRead_keepsFinalRefundedState() throws Exception {
        jdbcTemplate.update("""
                UPDATE payments
                SET status='captured', refund_status=NULL, refund_amount=NULL, stripe_charge_id='ch_concurrent_refund'
                WHERE payment_id='pay_s30_awaiting'
                """);
        String beforeBookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_s30_awaiting'",
                String.class
        );
        String payload = """
                {"id":"evt_webhook_concurrent_004","type":"charge.refunded","data":{"object":{"id":"ch_concurrent_refund","amount_refunded":5225,"refunded":true,"metadata":{"payment_id":"pay_s30_awaiting"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        CountDownLatch startGate = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(6);
        List<Future<Void>> futures = new ArrayList<>();
        try {
            futures.add(pool.submit(postWebhookTask(startGate, payload, signature)));
            for (int i = 0; i < 5; i++) {
                futures.add(pool.submit(getPaymentReadTask(startGate, "pay_s30_awaiting")));
            }
            startGate.countDown();
            for (Future<Void> f : futures) {
                f.get();
            }
        } finally {
            pool.shutdownNow();
        }

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_s30_awaiting'",
                String.class
        );
        String refundStatus = jdbcTemplate.queryForObject(
                "SELECT refund_status FROM payments WHERE payment_id='pay_s30_awaiting'",
                String.class
        );
        Double refundAmount = jdbcTemplate.queryForObject(
                "SELECT refund_amount FROM payments WHERE payment_id='pay_s30_awaiting'",
                Double.class
        );
        String afterBookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_s30_awaiting'",
                String.class
        );

        Assertions.assertEquals("refunded", paymentStatus);
        Assertions.assertEquals("succeeded", refundStatus);
        Assertions.assertEquals(52.25d, refundAmount);
        Assertions.assertEquals(beforeBookingStatus, afterBookingStatus);
    }

    @Test
    void expiryWorker_concurrentWithCheckoutCompletedWebhook_keepsBoundedFinalStates() throws Exception {
        String bookingId = "booking_exp_webhook_001";
        String paymentId = "pay_exp_webhook_001";
        jdbcTemplate.update("""
                INSERT INTO bookings (
                    booking_id, service_id, status, slot_id, payer_user_id, receiver_user_id,
                    expires_at, created_at, updated_at, payment_status, currency, payment_mode
                ) VALUES (?, 'svc_003', 'awaiting_payment', NULL, 'user_private001', 'user_admin001',
                          DATEADD('MINUTE', -10, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'authorized', 'EUR', 'pay_now')
                """, bookingId);
        jdbcTemplate.update("""
                INSERT INTO payments (
                    payment_id, booking_id, status, stripe_payment_intent_id, stripe_checkout_session_id,
                    payer_user_id, receiver_user_id, payer_total_amount, currency, updated_at
                ) VALUES (?, ?, 'authorized', NULL, 'cs_exp_webhook_001',
                          'user_private001', 'user_admin001', 40.00, 'EUR', CURRENT_TIMESTAMP)
                """, paymentId, bookingId);

        String payload = """
                {"id":"evt_webhook_concurrent_005","type":"checkout.session.completed","data":{"object":{"id":"cs_exp_webhook_001","mode":"payment","payment_status":"unpaid","metadata":{"payment_id":"pay_exp_webhook_001","booking_id":"booking_exp_webhook_001"}}}}
                """;
        String signature = signedHeader(payload, WEBHOOK_SECRET);

        CountDownLatch startGate = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<Future<Void>> futures = new ArrayList<>();
        try {
            futures.add(pool.submit(() -> {
                startGate.await();
                expiryWorkerService.processBatch(50);
                return null;
            }));
            futures.add(pool.submit(postWebhookTask(startGate, payload, signature)));
            startGate.countDown();
            for (Future<Void> f : futures) {
                f.get();
            }
        } finally {
            pool.shutdownNow();
        }

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id=?",
                String.class,
                bookingId
        );
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id=?",
                String.class,
                paymentId
        );
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id=?",
                String.class,
                bookingId
        );
        String eventStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM stripe_webhook_events WHERE event_id='evt_webhook_concurrent_005'",
                String.class
        );

        boolean workerWon = "expired".equals(bookingStatus) && "cancelled".equals(paymentStatus);
        boolean webhookWon = "confirmed".equals(bookingStatus) && "captured".equals(paymentStatus) && "paid".equals(bookingPaymentStatus);
        Assertions.assertTrue(workerWon || webhookWon);
        Assertions.assertEquals("success", eventStatus);
    }

    private Callable<Void> postWebhookTask(CountDownLatch startGate, String payload, String signature) {
        return () -> {
            startGate.await();
            mockMvc.perform(post("/api/webhook/stripe")
                            .contentType(MediaType.APPLICATION_JSON)
                            .header("Stripe-Signature", signature)
                            .content(payload))
                    .andExpect(status().isOk());
            return null;
        };
    }

    private Callable<Void> getCheckoutStatusTask(CountDownLatch startGate, String sessionId) {
        return () -> {
            startGate.await();
            mockMvc.perform(get("/api/payments/checkout/status/" + sessionId))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.session_id", is(sessionId)));
            return null;
        };
    }

    private Callable<Void> getPaymentReadTask(CountDownLatch startGate, String paymentId) {
        return () -> {
            startGate.await();
            mockMvc.perform(get("/api/payments/" + paymentId)
                            .header("Authorization", "Bearer " + TestJwtTokens.validUserToken()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.payment_id", is(paymentId)));
            return null;
        };
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
