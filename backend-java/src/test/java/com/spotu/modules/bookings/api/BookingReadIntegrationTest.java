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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingReadIntegrationTest {

    private static final String WEBHOOK_SECRET = "whsec_test_secret";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void myBookings_nominal_andAlias_ok() throws Exception {
        mockMvc.perform(get("/api/bookings/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].booking_id", is("booking_002")))
                .andExpect(jsonPath("$[0].pricing_snapshot.base_price", is(30.0)))
                .andExpect(jsonPath("$[0].slot_start_time", nullValue()));

        mockMvc.perform(get("/api/users/me/bookings")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].booking_id", is("booking_002")));
    }

    @Test
    void myBookings_emptyList_ok() throws Exception {
        mockMvc.perform(get("/api/bookings/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    void received_nominal_andAlias_ok() throws Exception {
        mockMvc.perform(get("/api/bookings/received")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].booking_id", is("booking_001")))
                .andExpect(jsonPath("$[0].payer_name", is("Zoé Robert")))
                .andExpect(jsonPath("$[0].address").doesNotExist())
                .andExpect(jsonPath("$[0].slot_start_time").doesNotExist());

        mockMvc.perform(get("/api/receiver/requests")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].booking_id", is("booking_001")));
    }

    @Test
    void strictAuth_absentOrInvalid_returns401() throws Exception {
        mockMvc.perform(get("/api/bookings/me").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(get("/api/bookings/received")
                        .header("Authorization", "Bearer invalid.token")
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void bookingDetail_notFound_forbidden_adminOk() throws Exception {
        mockMvc.perform(get("/api/bookings/booking_unknown")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));

        mockMvc.perform(get("/api/bookings/booking_002")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Accès refusé")));

        mockMvc.perform(get("/api/bookings/booking_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payer_name", is("Zoé Robert")))
                .andExpect(jsonPath("$.service_images[0]", is("https://img/1.jpg")));
    }

    @Test
    void bookingReads_reflectS33WebhookConfirmedAndPaid() throws Exception {
        jdbcTemplate.update(
                "UPDATE bookings SET status='confirmed', payment_status='paid' WHERE booking_id='booking_s30_awaiting'"
        );

        mockMvc.perform(get("/api/bookings/booking_s30_awaiting")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("confirmed")))
                .andExpect(jsonPath("$.payment_status", is("paid")));
    }

    @Test
    void bookingReads_doNotExposeRefundFieldsAfterS35Refund() throws Exception {
        String payload = """
                {
                  "id": "evt_s36_charge_refunded",
                  "type": "charge.refunded",
                  "data": {
                    "object": {
                      "id": "ch_ref_001",
                      "amount_refunded": 4400,
                      "refunded": true,
                      "metadata": {
                        "payment_id": "pay_ref_full"
                      }
                    }
                  }
                }
                """;

        mockMvc.perform(post("/api/webhook/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Stripe-Signature", signedHeader(payload))
                        .content(payload))
                .andExpect(status().isOk());

        String body = mockMvc.perform(get("/api/bookings/booking_042")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("confirmed")))
                .andExpect(jsonPath("$.payment_status", is("paid")))
                .andReturn()
                .getResponse()
                .getContentAsString();

        Assertions.assertFalse(body.contains("refund_amount"));
        Assertions.assertFalse(body.contains("refund_status"));
    }

    @Test
    void bookingDetail_permissions_includeCoachIdAndLegacyUserId() throws Exception {
        mockMvc.perform(get("/api/bookings/booking_025")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/bookings/booking_025")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }

    @Test
    void bookingRead_datetimeFormat_isPlus00_notZulu() throws Exception {
        String body = mockMvc.perform(get("/api/bookings/booking_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        Assertions.assertTrue(body.contains("+00:00"));
        Assertions.assertFalse(body.contains("\"Z\""));
    }

    private static String signedHeader(String payload) throws Exception {
        long ts = Instant.now().getEpochSecond();
        String signedPayload = ts + "." + payload;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(WEBHOOK_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] digest = mac.doFinal(signedPayload.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            hex.append(String.format("%02x", b));
        }
        return "t=" + ts + ",v1=" + hex;
    }
}
