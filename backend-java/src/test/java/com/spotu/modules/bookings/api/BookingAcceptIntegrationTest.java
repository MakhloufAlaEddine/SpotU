package com.spotu.modules.bookings.api;

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

import java.time.Instant;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingAcceptIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void accept_nominal_caseA_confirmedAndCaptured() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_008/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("confirmed")))
                .andExpect(jsonPath("$.booking_id", is("booking_008")))
                .andExpect(jsonPath("$.payment_mode", is("pay_now")))
                .andExpect(jsonPath("$.payment_captured", is(true)))
                .andExpect(jsonPath("$.pay_expiry_interval").doesNotExist())
                .andExpect(jsonPath("$.idempotent").doesNotExist());

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_008'", String.class);
        String bookingPaymentStatus = jdbcTemplate.queryForObject(
                "SELECT payment_status FROM bookings WHERE booking_id='booking_008'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_008'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_accept_authorized'", String.class);
        Object expiresAt = jdbcTemplate.queryForObject(
                "SELECT expires_at FROM bookings WHERE booking_id='booking_008'", Object.class);

        Assertions.assertEquals("confirmed", bookingStatus);
        Assertions.assertEquals("captured", bookingPaymentStatus);
        Assertions.assertEquals("captured", paymentStatus);
        Assertions.assertEquals("booked", slotStatus);
        Assertions.assertNull(expiresAt);
    }

    @Test
    void accept_nominal_caseB_payNow_awaitingPaymentAndReserved() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_009/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("awaiting_payment")))
                .andExpect(jsonPath("$.booking_id", is("booking_009")))
                .andExpect(jsonPath("$.payment_mode", is("pay_now")))
                .andExpect(jsonPath("$.pay_expiry_interval", is("45 minutes")))
                .andExpect(jsonPath("$.payment_captured").doesNotExist());

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_009'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_009'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_accept_pending'", String.class);
        Instant expiresAt = jdbcTemplate.queryForObject(
                "SELECT expires_at FROM bookings WHERE booking_id='booking_009'", Instant.class);

        Assertions.assertEquals("awaiting_payment", bookingStatus);
        Assertions.assertEquals("pending", paymentStatus);
        Assertions.assertEquals("reserved", slotStatus);
        Assertions.assertNotNull(expiresAt);
    }

    @Test
    void accept_payLater_fallbackTo1440MinutesWhenServiceSettingMissing() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_010/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("awaiting_payment")))
                .andExpect(jsonPath("$.payment_mode", is("pay_later")))
                .andExpect(jsonPath("$.pay_expiry_interval", is("1440 minutes")));
    }

    @Test
    void accept_payNow_fallbackTo30MinutesWhenConfigMissing() throws Exception {
        jdbcTemplate.update("DELETE FROM app_config WHERE config_key='pay_now_checkout_minutes'");

        mockMvc.perform(post("/api/bookings/booking_014/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("awaiting_payment")))
                .andExpect(jsonPath("$.pay_expiry_interval", is("30 minutes")));
    }

    @Test
    void accept_idempotent_returnsRealStatus() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_007/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("confirmed")))
                .andExpect(jsonPath("$.booking_id", is("booking_007")))
                .andExpect(jsonPath("$.idempotent", is(true)));
    }

    @Test
    void accept_forbidden_whenNeitherReceiverNorAdmin() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_009/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Seul le bénéficiaire peut accepter cette réservation")));
    }

    @Test
    void accept_adminAllowed_evenWhenNotReceiver() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_016/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("awaiting_payment")));
    }

    @Test
    void accept_notFound_whenBookingOrJoinedServiceMissing() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_unknown/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));

        mockMvc.perform(post("/api/bookings/booking_015/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));
    }

    @Test
    void accept_expiredBooking_returns410() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_013/accept")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.detail", is("Cette réservation a expiré — le créneau a été libéré")));
    }

    @Test
    void accept_absentOrInvalidToken_returns401() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_009/accept")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/bookings/booking_009/accept")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}
