package com.spotu.modules.bookings.api;

import com.spotu.modules.auth.support.TestJwtTokens;
import com.spotu.modules.payments.stripe.StripePaymentService;
import com.stripe.model.PaymentIntent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.anyString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingLegacyStatusAliasIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private StripePaymentService stripePaymentService;

    @BeforeEach
    void stubStripeNetwork() throws Exception {
        PaymentIntent pi = Mockito.mock(PaymentIntent.class);
        Mockito.when(pi.getId()).thenReturn("pi_test_alias");
        Mockito.when(pi.getStatus()).thenReturn("canceled");
        Mockito.when(stripePaymentService.cancelPaymentIntent(anyString(), anyString())).thenReturn(pi);
    }

    @Test
    void patchStatus_confirmed_aliasDelegatesToAccept() throws Exception {
        mockMvc.perform(patch("/api/bookings/booking_009/status")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"confirmed\"}")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("awaiting_payment")))
                .andExpect(jsonPath("$.booking_id", is("booking_009")));
    }

    @Test
    void patchStatus_cancelled_aliasDelegatesToCancel() throws Exception {
        mockMvc.perform(patch("/api/bookings/booking_020/status")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"cancelled\",\"reason\":\"Legacy alias reason\"}")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success", is(true)))
                .andExpect(jsonPath("$.status", is("cancelled")))
                .andExpect(jsonPath("$.payment_status", is("cancelled")))
                .andExpect(jsonPath("$.booking_id", is("booking_020")));
    }

    @Test
    void patchStatus_unsupported_returns400() throws Exception {
        mockMvc.perform(patch("/api/bookings/booking_020/status")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"pending\"}")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("BAD_REQUEST")))
                .andExpect(jsonPath("$.detail", is("Statut booking non supporté pour cet alias legacy")));
    }
}
