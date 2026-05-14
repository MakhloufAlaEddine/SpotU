package com.spotu.modules.payments.api;

import com.spotu.modules.auth.support.TestJwtTokens;
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

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class CheckoutIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void post_nominal_createsSession_andUpdatesPayment() throws Exception {
        mockMvc.perform(post("/api/payments/checkout/session")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"booking_id":"booking_040","origin_url":"https://app.spotu.fr/"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url", startsWith("https://checkout.stripe.com/pay/cs_test_")))
                .andExpect(jsonPath("$.session_id", startsWith("cs_test_")));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_040'", String.class);
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_040'", String.class);
        String checkoutSessionId = jdbcTemplate.queryForObject(
                "SELECT stripe_checkout_session_id FROM payments WHERE payment_id='pay_040'", String.class);

        Assertions.assertEquals("requires_authorization", paymentStatus);
        Assertions.assertEquals("requires_authorization", bookingPaymentStatus);
        Assertions.assertTrue(checkoutSessionId.startsWith("cs_test_"));
    }

    @Test
    void post_withoutToken_returns401() throws Exception {
        mockMvc.perform(post("/api/payments/checkout/session")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"booking_id":"booking_040","origin_url":"https://app.spotu.fr"}
                                """))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void post_notPayer_returns404_not403() throws Exception {
        mockMvc.perform(post("/api/payments/checkout/session")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"booking_id":"booking_040","origin_url":"https://app.spotu.fr"}
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Paiement non trouvé")));
    }

    @Test
    void get_nominal_completeUnpaid_awaitingPayment_setsCaptured_andSendsTwoNotifications() throws Exception {
        jdbcTemplate.update("""
                UPDATE payments
                SET stripe_checkout_session_id='cs_status_complete_unpaid_040',
                    payer_user_id='user_private001',
                    receiver_user_id='user_admin001'
                WHERE payment_id='pay_040'
                """);

        Integer before = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM notifications", Integer.class);

        mockMvc.perform(get("/api/payments/checkout/status/cs_status_complete_unpaid_040"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment_id", is("pay_040")))
                .andExpect(jsonPath("$.status", is("complete")))
                .andExpect(jsonPath("$.payment_status", is("captured")))
                .andExpect(jsonPath("$.stripe_status", is("unpaid")));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_040'", String.class);
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_040'", String.class);
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_040'", String.class);
        Integer after = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM notifications", Integer.class);

        Assertions.assertEquals("captured", paymentStatus);
        Assertions.assertEquals("confirmed", bookingStatus);
        Assertions.assertEquals("paid", bookingPaymentStatus);
        Assertions.assertEquals(before + 2, after);
    }

    @Test
    void get_nominal_completeUnpaid_requested_setsAuthorized() throws Exception {
        mockMvc.perform(get("/api/payments/checkout/status/cs_status_complete_unpaid_041"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment_id", is("pay_041")))
                .andExpect(jsonPath("$.session_id", is("cs_status_complete_unpaid_041")))
                .andExpect(jsonPath("$.status", is("complete")))
                .andExpect(jsonPath("$.payment_status", is("authorized")))
                .andExpect(jsonPath("$.stripe_status", is("unpaid")));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE payment_id='pay_041'", String.class);
        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_041'", String.class);
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_041'", String.class);

        Assertions.assertEquals("authorized", paymentStatus);
        Assertions.assertEquals("requested", bookingStatus);
        Assertions.assertEquals("authorized", bookingPaymentStatus);
    }

    @Test
    void get_lookupWithPaymentIntentId_usesDoubleKey() throws Exception {
        mockMvc.perform(get("/api/payments/checkout/status/pi_checkout_041"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment_id", is("pay_041")))
                .andExpect(jsonPath("$.session_id", is("pi_checkout_041")))
                .andExpect(jsonPath("$.status", is("complete")));
    }

    @Test
    void get_unknownSession_returns404() throws Exception {
        mockMvc.perform(get("/api/payments/checkout/status/cs_missing_999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Session de paiement non trouvée")));
    }

    @Test
    void get_stripeFailure_returnsUnknown_without500() throws Exception {
        mockMvc.perform(get("/api/payments/checkout/status/cs_status_fail_045"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment_id", is("pay_045")))
                .andExpect(jsonPath("$.status", is("unknown")))
                .andExpect(jsonPath("$.payment_status", is("requires_authorization")))
                .andExpect(jsonPath("$.amount", is(40.0)))
                .andExpect(jsonPath("$.currency", is("EUR")))
                .andExpect(jsonPath("$.stripe_status").doesNotExist());
    }

    @Test
    void get_authOptional_withoutAndInvalidToken_never401() throws Exception {
        mockMvc.perform(get("/api/payments/checkout/status/cs_status_complete_unpaid_041"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/payments/checkout/status/cs_status_complete_unpaid_041")
                        .header("Authorization", "Bearer invalid.token"))
                .andExpect(status().isOk());
    }
}
