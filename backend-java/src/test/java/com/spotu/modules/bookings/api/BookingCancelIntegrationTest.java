package com.spotu.modules.bookings.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import com.spotu.modules.payments.stripe.StripePaymentService;
import com.stripe.model.PaymentIntent;
import com.stripe.model.Refund;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;

import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingCancelIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockBean
    private StripePaymentService stripePaymentService;

    @BeforeEach
    void stubStripeNetwork() throws Exception {
        PaymentIntent pi = Mockito.mock(PaymentIntent.class);
        Mockito.when(pi.getId()).thenReturn("pi_test");
        Mockito.when(pi.getStatus()).thenReturn("canceled");
        Mockito.when(stripePaymentService.cancelPaymentIntent(anyString(), anyString())).thenReturn(pi);

        Refund refund = Mockito.mock(Refund.class);
        Mockito.when(refund.getId()).thenReturn("re_test");
        Mockito.when(stripePaymentService.createRefund(anyString(), isNull(), anyString(), anyString())).thenReturn(refund);
    }

    @Test
    void cancel_nominal_payer_updatesBookingPaymentAndSlot() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_020/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Imprévu\"}")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.booking_id", is("booking_020")))
                .andExpect(jsonPath("$.payment_status", is("cancelled")))
                .andExpect(jsonPath("$.cancelled_by", is("user_private001")))
                .andExpect(jsonPath("$.stripe_action", is("pi_cancelled")));

        String bookingStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM bookings WHERE booking_id='booking_020'", String.class);
        String reason = jdbcTemplate.queryForObject(
                "SELECT cancellation_reason FROM bookings WHERE booking_id='booking_020'", String.class);
        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_020'", String.class);
        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_cancel_pending'", String.class);

        Assertions.assertEquals("cancelled", bookingStatus);
        Assertions.assertEquals("Imprévu", reason);
        Assertions.assertEquals("cancelled", paymentStatus);
        Assertions.assertEquals("available", slotStatus);
    }

    @Test
    void cancel_nominal_receiver_onlyAccepted() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_021/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.payment_status", is("cancelled")))
                .andExpect(jsonPath("$.cancelled_by", is("user_private001")))
                .andExpect(jsonPath("$.stripe_action", is("pi_cancelled")));
    }

    @Test
    void cancel_nominal_admin_refundWithChargeId() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_022/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.payment_status", is("refunded")))
                .andExpect(jsonPath("$.stripe_action", is("refund_created")));

        String slotStatus = jdbcTemplate.queryForObject(
                "SELECT slot_status FROM service_slots WHERE slot_id='slot_cancel_booked'", String.class);
        Assertions.assertEquals("available", slotStatus);
    }

    @Test
    void cancel_receiverWrongState_returns409_not403() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_023/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is(
                        "Le bénéficiaire peut annuler uniquement une réservation acceptée (état actuel : 'requested'). Pour refuser une demande en attente, utilisez /refuse."
                )));
    }

    @Test
    void cancel_legacyPayerField_userIdWithoutPayerUserId_isAuthorized() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_025/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.cancelled_by", is("user_zoe001")))
                .andExpect(jsonPath("$.payment_status", is("pending")))
                .andExpect(jsonPath("$.stripe_action", nullValue()));
    }

    @Test
    void cancel_capturedWithoutChargeId_keepsStripeActionNullButUpdatesDb() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_026/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.payment_status", is("refunded")))
                .andExpect(jsonPath("$.stripe_action", nullValue()));

        String paymentStatus = jdbcTemplate.queryForObject(
                "SELECT status FROM payments WHERE booking_id='booking_026'", String.class);
        Assertions.assertEquals("refunded", paymentStatus);
    }

    @Test
    void cancel_withoutPaymentRow_returnsEmptyPaymentStatus() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_027/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.payment_status", is("")))
                .andExpect(jsonPath("$.stripe_action", nullValue()));
    }

    @Test
    void cancel_notFound_and_nonCancellable_and_forbidden() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_unknown/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));

        mockMvc.perform(post("/api/bookings/booking_024/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Impossible d'annuler une réservation en état 'completed'")));

        mockMvc.perform(post("/api/bookings/booking_020/cancel")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Vous n'êtes pas autorisé à annuler cette réservation")));
    }

    @Test
    void cancel_absentOrInvalidToken_returns401() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_020/cancel")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/bookings/booking_020/cancel")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }
}
