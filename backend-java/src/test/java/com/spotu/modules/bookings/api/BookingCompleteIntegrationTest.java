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

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingCompleteIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void complete_nominal_updatesBookingSlotAndAuthorizedPayment() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_017/complete")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("completed")))
                .andExpect(jsonPath("$.booking_id").doesNotExist());

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_017'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_complete_booked'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_017'", String.class);

        Assertions.assertEquals("completed", bookingStatus);
        Assertions.assertEquals("completed", slotStatus);
        Assertions.assertEquals("captured", paymentStatus);
    }

    @Test
    void complete_forbidden_whenNeitherReceiverNorAdmin() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_017/complete")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Seul le bénéficiaire peut marquer comme terminé")));
    }

    @Test
    void complete_notFound_returns404() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_unknown/complete")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));
    }

    @Test
    void complete_slotNull_isSilentNoopOnSlotAndCapturesOnlyAuthorized() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_018/complete")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("completed")));

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_018'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_018'", String.class);

        Assertions.assertEquals("completed", bookingStatus);
        Assertions.assertEquals("requires_authorization", paymentStatus);
    }

    @Test
    void complete_no409_whenSourceStatusIsRefused() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_019/complete")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("completed")));

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_019'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_complete_reserved'", String.class);
        Assertions.assertEquals("completed", bookingStatus);
        Assertions.assertEquals("reserved", slotStatus);
    }

    @Test
    void complete_paymentAlreadyCaptured_remainsCaptured() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_005/complete")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("completed")));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_005'", String.class);
        Assertions.assertEquals("captured", paymentStatus);
    }

    @Test
    void complete_absentOrInvalidToken_returns401() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_017/complete")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/bookings/booking_017/complete")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}
