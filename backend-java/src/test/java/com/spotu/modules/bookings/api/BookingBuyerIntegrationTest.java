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

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;

import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class BookingBuyerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private DataSource dataSource;

    @Test
    void pricePreview_nominal_and_errors() throws Exception {
        mockMvc.perform(post("/api/bookings/price-preview")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"service_id\":\"svc_003\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.base_amount", is(55.0)))
                .andExpect(jsonPath("$.currency", is("EUR")))
                .andExpect(jsonPath("$.platform_total_fee", is(7.86)));

        mockMvc.perform(post("/api/bookings/price-preview")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("service_id requis")));

        mockMvc.perform(post("/api/bookings/price-preview")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"service_id\":\"svc_missing\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Service introuvable ou inactif")));
    }

    @Test
    void pricePreview_ignoresAppConfigFlags_andKeepsExactProjection() throws Exception {
        jdbcTemplate.update("UPDATE app_config SET config_value='false' WHERE config_key='enable_manual_approval_for_services'");
        jdbcTemplate.update("UPDATE app_config SET config_value='false' WHERE config_key='enable_pay_later_for_services'");

        mockMvc.perform(post("/api/bookings/price-preview")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"service_id\":\"svc_003\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.base_amount", is(55.0)))
                .andExpect(jsonPath("$.currency", is("EUR")))
                .andExpect(jsonPath("$.payer_total_amount", is(57.38)))
                .andExpect(jsonPath("$", hasKey("base_amount")))
                .andExpect(jsonPath("$", hasKey("payer_fixed_fee")))
                .andExpect(jsonPath("$", hasKey("payer_percent_fee_amount")))
                .andExpect(jsonPath("$", hasKey("receiver_fixed_fee")))
                .andExpect(jsonPath("$", hasKey("receiver_percent_fee_amount")))
                .andExpect(jsonPath("$", hasKey("platform_total_fee")))
                .andExpect(jsonPath("$", hasKey("receiver_net_amount")))
                .andExpect(jsonPath("$", hasKey("payer_total_amount")))
                .andExpect(jsonPath("$", hasKey("currency")))
                .andExpect(jsonPath("$.payment_mode").doesNotExist())
                .andExpect(jsonPath("$.status").doesNotExist())
                .andExpect(jsonPath("$.service_id").doesNotExist());
    }

    @Test
    void request_nominal_and_idempotencyKey_and_alias() throws Exception {
        jdbcTemplate.update("UPDATE app_config SET config_value='true' WHERE config_key='enable_pay_later_for_services'");
        jdbcTemplate.update("UPDATE app_config SET config_value='false' WHERE config_key='enable_manual_approval_for_services'");

        mockMvc.perform(post("/api/bookings/request")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "service_id":"svc_003",
                                  "slot_id":"slot_accept_available",
                                  "scheduled_at":"2099-02-20T09:00:00Z",
                                  "idempotency_key":"idem_s30_req_1",
                                  "payment_mode":"pay_now"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.booking_id", startsWith("bkg_")))
                .andExpect(jsonPath("$.status", is("awaiting_payment")))
                .andExpect(jsonPath("$.payment_status", is("pending")))
                .andExpect(jsonPath("$.payment_mode", is("pay_now")))
                .andExpect(jsonPath("$.service_title", is("Service Admin")))
                .andExpect(jsonPath("$.pricing_snapshot", hasKey("payer_total_amount")));

        mockMvc.perform(post("/api/bookings")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "service_id":"svc_003",
                                  "slot_id":"slot_accept_available",
                                  "scheduled_at":"2099-02-20T09:00:00Z",
                                  "idempotency_key":"idem_s30_req_1",
                                  "payment_mode":"pay_now"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotency_key", is("idem_s30_req_1")));

        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM bookings WHERE idempotency_key='idem_s30_req_1'",
                Integer.class
        );
        Assertions.assertEquals(1, count);
    }

    @Test
    void request_guards_payLater_and_slot_conflicts() throws Exception {
        mockMvc.perform(post("/api/bookings/request")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"service_id":"svc_003","slot_id":"slot_accept_available","payment_mode":"pay_later"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Le paiement différé n'est pas activé sur cette plateforme — veuillez choisir 'pay_now'")));

        jdbcTemplate.update("UPDATE app_config SET config_value='true' WHERE config_key='enable_pay_later_for_services'");
        jdbcTemplate.update("UPDATE services SET allow_pay_later=FALSE WHERE service_id='svc_003'");

        mockMvc.perform(post("/api/bookings/request")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"service_id":"svc_003","slot_id":"slot_accept_available","payment_mode":"pay_later"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail", is("Ce service ne permet pas le paiement différé")));

        mockMvc.perform(post("/api/bookings/request")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"service_id":"svc_003","slot_id":"slot_accept_authorized","payment_mode":"pay_now"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail", is("Créneau indisponible (état : reserved)")));
    }

    @Test
    void request_lockNowait_returns409_when_slot_is_locked() throws Exception {
        try (Connection lockConn = dataSource.getConnection(); Statement st = lockConn.createStatement()) {
            lockConn.setAutoCommit(false);
            st.execute("SELECT slot_id FROM service_slots WHERE slot_id='slot_accept_available' FOR UPDATE");

            mockMvc.perform(post("/api/bookings/request")
                            .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"service_id":"svc_003","slot_id":"slot_accept_available","payment_mode":"pay_now"}
                                    """))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.detail", is("Ce créneau est en cours de réservation — réessayez")));

            lockConn.rollback();
        }
    }

    @Test
    void pay_nominal_and_reused() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_s30_awaiting/pay")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"origin_url\":\"https://app.spotu.fr\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url", startsWith("https://checkout.stripe.com/pay/cs_test_")))
                .andExpect(jsonPath("$.checkout_url", startsWith("https://checkout.stripe.com/pay/cs_test_")))
                .andExpect(jsonPath("$.session_id", startsWith("cs_test_")))
                .andExpect(jsonPath("$.reused").doesNotExist());

        String session = jdbcTemplate.queryForObject(
                "SELECT stripe_checkout_session_id FROM payments WHERE payment_id='pay_s30_awaiting'",
                String.class
        );
        Assertions.assertNotNull(session);

        mockMvc.perform(post("/api/bookings/booking_s30_awaiting/pay")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"origin_url\":\"https://app.spotu.fr\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session_id", is(session)))
                .andExpect(jsonPath("$.reused", is(true)));
    }

    @Test
    void pay_errors_401_403_404_410_500() throws Exception {
        mockMvc.perform(post("/api/bookings/booking_s30_awaiting/pay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/bookings/booking_s30_awaiting/pay")
                        .header("Authorization", "Bearer " + TestJwtTokens.validCoachToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Seul le payeur peut initier le paiement")));

        mockMvc.perform(post("/api/bookings/booking_unknown/pay")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Réservation introuvable")));

        jdbcTemplate.update("UPDATE bookings SET expires_at = TIMESTAMP WITH TIME ZONE '2020-01-01 00:00:00+00:00' WHERE booking_id='booking_s30_expired'");
        mockMvc.perform(post("/api/bookings/booking_s30_expired/pay")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.detail", is("Le délai de paiement a expiré — réservation annulée")));

        jdbcTemplate.update("DELETE FROM payments WHERE booking_id='booking_s30_awaiting'");
        mockMvc.perform(post("/api/bookings/booking_s30_awaiting/pay")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.detail", is("Enregistrement de paiement manquant pour cette réservation")));
    }

    @Test
    void request_and_pay_require_auth() throws Exception {
        mockMvc.perform(post("/api/bookings/request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"service_id\":\"svc_003\"}"))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/bookings/booking_s30_awaiting/pay")
                        .header("Authorization", "Bearer invalid.token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
