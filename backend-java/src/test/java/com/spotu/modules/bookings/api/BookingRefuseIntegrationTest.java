package com.spotu.modules.bookings.api;

import com.spotu.modules.auth.support.TestJwtTokens;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingRefuseIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void refuse_nominal_updatesBookingPaymentAndPendingSlot() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_004/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("refused")))
                .andExpect(jsonPath("$.booking_id", is("booking_004")))
                .andExpect(jsonPath("$.idempotent").doesNotExist());

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_004'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_004'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_pending_refuse'", String.class);

        org.junit.jupiter.api.Assertions.assertEquals("refused", bookingStatus);
        org.junit.jupiter.api.Assertions.assertEquals("cancelled", paymentStatus);
        org.junit.jupiter.api.Assertions.assertEquals("available", slotStatus);
    }

    @Test
    void refuse_nonReceiver_forbidden() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_004/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Seul le bénéficiaire peut refuser cette réservation")));
    }

    @Test
    void refuse_notFound_returns404() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_unknown/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));
    }

    @Test
    void refuse_idempotent_whenAlreadyRefused() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_006/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("refused")))
                .andExpect(jsonPath("$.idempotent", is(true)))
                .andExpect(jsonPath("$.booking_id").doesNotExist());
    }

    @Test
    void refuse_conflict_whenStatusIncompatible() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_007/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Impossible de refuser une réservation en état 'confirmed'")));
    }

    @Test
    void refuse_reservedSlotAndCapturedPaymentRemainUnchanged() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_005/refuse")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("refused")));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_005'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_reserved_refuse'", String.class);

        org.junit.jupiter.api.Assertions.assertEquals("captured", paymentStatus);
        org.junit.jupiter.api.Assertions.assertEquals("reserved", slotStatus);
    }

    @Test
    void refuse_absentOrInvalidToken_returns401() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_004/refuse")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/bookings/booking_004/refuse")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}
