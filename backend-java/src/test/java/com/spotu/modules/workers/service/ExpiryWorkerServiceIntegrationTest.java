package com.spotu.modules.workers.service;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import com.spotu.modules.payments.stripe.StripePaymentService;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class ExpiryWorkerServiceIntegrationTest {

    @Autowired
    private ExpiryWorkerService expiryWorkerService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private StripePaymentService stripePaymentService;

    @BeforeEach
    void neutralizeExistingExpiredFixtures() {
        jdbcTemplate.update("""
                UPDATE bookings
                SET expires_at = DATEADD('DAY', 2, CURRENT_TIMESTAMP)
                WHERE booking_id='booking_013'
                """);
    }

    @Test
    void batchSimple_expiresBooking_releasesSlot_cancelsPayment_andInsertsNotifications() throws com.stripe.exception.StripeException {
        insertExpiredBooking("booking_exp_001", "requested", "slot_exp_001", "pay_exp_001", "requires_authorization", "pi_exp_001");

        int processed = expiryWorkerService.processBatch(50);
        Assertions.assertEquals(1, processed);

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_exp_001'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_exp_001'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_exp_001'", String.class);
        Integer notifCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE data LIKE '%\"bookingId\":\"booking_exp_001\"%'", Integer.class);

        Assertions.assertEquals("expired", bookingStatus);
        Assertions.assertEquals("available", slotStatus);
        Assertions.assertEquals("cancelled", paymentStatus);
        Assertions.assertEquals(2, notifCount);
        Mockito.verify(stripePaymentService, Mockito.times(1)).cancelPaymentIntent("pi_exp_001", "expired");
    }

    @Test
    void drainLoop_backlogGreaterThan50_processesAll() {
        for (int i = 0; i < 120; i++) {
            String id = "booking_exp_many_" + i;
            insertExpiredBookingNoPayment(id, "requested");
        }
        int total = expiryWorkerService.drainExpiredBookings();
        Assertions.assertEquals(120, total);

        Integer expiredCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM bookings WHERE booking_id LIKE 'booking_exp_many_%' AND status='expired'", Integer.class);
        Assertions.assertEquals(120, expiredCount);
    }

    @Test
    void idempotence_secondRunDoesNothing() {
        insertExpiredBooking("booking_exp_002", "awaiting_payment", "slot_exp_002", "pay_exp_002", "authorized", "pi_exp_002");

        int first = expiryWorkerService.drainExpiredBookings();
        int second = expiryWorkerService.drainExpiredBookings();

        Assertions.assertEquals(1, first);
        Assertions.assertEquals(0, second);
        Integer notifCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM notifications WHERE data LIKE '%\"bookingId\":\"booking_exp_002\"%'", Integer.class);
        Assertions.assertEquals(2, notifCount);
    }

    @Test
    void paymentAbsent_isSupported() {
        insertExpiredBookingNoPayment("booking_exp_003", "requested");
        int processed = expiryWorkerService.drainExpiredBookings();
        Assertions.assertEquals(1, processed);
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_exp_003'", String.class);
        Assertions.assertEquals("expired", bookingStatus);
    }

    @Test
    void stripeError_isSwallowed_afterCommit() throws com.stripe.exception.StripeException {
        insertExpiredBooking("booking_exp_004", "requested", "slot_exp_004", "pay_exp_004", "requires_authorization", "pi_exp_004");
        Mockito.doAnswer(invocation -> {
            String paymentStatus = jdbcTemplate.queryForObject(
                    "SELECT status FROM payments WHERE payment_id='pay_exp_004'", String.class);
            Assertions.assertEquals("cancelled", paymentStatus);
            throw new IllegalStateException("stripe down");
        }).when(stripePaymentService).cancelPaymentIntent("pi_exp_004", "expired");

        int processed = expiryWorkerService.drainExpiredBookings();
        Assertions.assertEquals(1, processed);
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_exp_004'", String.class);
        Assertions.assertEquals("expired", bookingStatus);
    }

    @Test
    void concurrentCalls_doNotDoubleProcess() throws Exception {
        for (int i = 0; i < 20; i++) {
            insertExpiredBookingNoPayment("booking_exp_conc_" + i, "requested");
        }
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            CompletableFuture<Integer> f1 = CompletableFuture.supplyAsync(expiryWorkerService::drainExpiredBookings, executor);
            CompletableFuture<Integer> f2 = CompletableFuture.supplyAsync(expiryWorkerService::drainExpiredBookings, executor);
            int total = f1.get() + f2.get();

            Integer expiredCount = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM bookings WHERE booking_id LIKE 'booking_exp_conc_%' AND status='expired'", Integer.class);
            Assertions.assertEquals(20, expiredCount);
            Assertions.assertEquals(20, total);
        } finally {
            executor.shutdownNow();
        }
    }

    private void insertExpiredBooking(
            String bookingId,
            String bookingStatus,
            String slotId,
            String paymentId,
            String paymentStatus,
            String piId
    ) {
        jdbcTemplate.update("""
                INSERT INTO service_slots (slot_id, service_id, slot_type, slot_status)
                VALUES (?, 'svc_003', 'single', ?)
                """, slotId, "awaiting_payment".equals(bookingStatus) ? "reserved" : "pending");

        jdbcTemplate.update("""
                INSERT INTO bookings (
                    booking_id, service_id, status, slot_id, payer_user_id, receiver_user_id,
                    expires_at, created_at, updated_at, payment_status, currency, payment_mode
                ) VALUES (?, 'svc_003', ?, ?, 'user_private001', 'user_admin001',
                          ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'pending', 'EUR', 'pay_now')
                """, bookingId, bookingStatus, slotId, Timestamp.from(Instant.now().minusSeconds(3600)));

        jdbcTemplate.update("""
                INSERT INTO payments (
                    payment_id, booking_id, status, stripe_payment_intent_id, stripe_checkout_session_id,
                    payer_total_amount, updated_at
                ) VALUES (?, ?, ?, ?, NULL, 40.00, CURRENT_TIMESTAMP)
                """, paymentId, bookingId, paymentStatus, piId);
    }

    private void insertExpiredBookingNoPayment(String bookingId, String bookingStatus) {
        jdbcTemplate.update("""
                INSERT INTO bookings (
                    booking_id, service_id, status, slot_id, payer_user_id, receiver_user_id,
                    expires_at, created_at, updated_at, payment_status, currency, payment_mode
                ) VALUES (?, 'svc_003', ?, NULL, 'user_private001', 'user_admin001',
                          ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'pending', 'EUR', 'pay_now')
                """, bookingId, bookingStatus, Timestamp.from(Instant.now().minusSeconds(7200)));
    }
}
