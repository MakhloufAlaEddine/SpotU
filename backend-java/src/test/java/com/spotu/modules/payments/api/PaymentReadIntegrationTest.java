package com.spotu.modules.payments.api;

import com.spotu.modules.auth.service.JwtService;
import com.spotu.modules.auth.support.TestJwtTokens;
import jakarta.servlet.http.Cookie;
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

import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/test-data-users.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class PaymentReadIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private JwtService jwtService;

    @Test
    void paymentsMe_nominal_noPagination_andNamesAndSnapshot() throws Exception {
        jdbcTemplate.update("UPDATE payments SET created_at=TIMESTAMP WITH TIME ZONE '2026-04-16 10:00:00+00:00' WHERE payment_id='pay_s30_awaiting'");
        jdbcTemplate.update("UPDATE payments SET created_at=TIMESTAMP WITH TIME ZONE '2026-04-16 09:00:00+00:00' WHERE payment_id='pay_s30_expired'");

        mockMvc.perform(get("/api/payments/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].payment_id", is("pay_s30_awaiting")))
                .andExpect(jsonPath("$[0].payer_name", is("Marie Martin")))
                .andExpect(jsonPath("$[0].receiver_name", is("Admin Test")))
                .andExpect(jsonPath("$[0].pricing_rule_snapshot.base_amount", is(50.0)));
    }

    @Test
    void paymentsMe_cookieFallbackAuth_ok() throws Exception {
        mockMvc.perform(get("/api/payments/me")
                        .cookie(new Cookie("winek_token", TestJwtTokens.validUserToken()))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }

    @Test
    void paymentsMe_emptyList_returns200Array() throws Exception {
        jdbcTemplate.update("INSERT INTO users (user_id, name, role) VALUES ('user_nopay_001', 'No Pay', 'user')");
        String token = jwtService.createJwt("user_nopay_001", "user");

        mockMvc.perform(get("/api/payments/me")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", is(0)));
    }

    @Test
    void paymentsMe_authMissing_401() throws Exception {
        mockMvc.perform(get("/api/payments/me")
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail", is("Not authenticated")));
    }

    @Test
    void paymentDetail_nominalPayer_200_andNoNames() throws Exception {
        mockMvc.perform(get("/api/payments/pay_s30_awaiting")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment_id", is("pay_s30_awaiting")))
                .andExpect(jsonPath("$", hasKey("pricing_rule_snapshot")))
                .andExpect(jsonPath("$", not(hasKey("payer_name"))))
                .andExpect(jsonPath("$", not(hasKey("receiver_name"))));
    }

    @Test
    void paymentDetail_notFound_beforeForbidden_404Then403() throws Exception {
        mockMvc.perform(get("/api/payments/pay_missing_001")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail", is("Payment not found")));

        mockMvc.perform(get("/api/payments/pay_s30_awaiting")
                        .header("Authorization", "Bearer " + TestJwtTokens.validZoeToken())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail", is("Access denied")));
    }

    @Test
    void paymentDetail_adminCanAccess_200() throws Exception {
        mockMvc.perform(get("/api/payments/pay_s30_awaiting")
                        .header("Authorization", "Bearer " + TestJwtTokens.validAdminToken())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payment_id", is("pay_s30_awaiting")));
    }

    @Test
    void paymentsMe_datetimeFormat_plus0000_notZ() throws Exception {
        String body = mockMvc.perform(get("/api/payments/me")
                        .header("Authorization", "Bearer " + TestJwtTokens.validUserToken())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        Assertions.assertTrue(body.contains("+00:00"));
    }
}
