package com.spotu.modules.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Données absentes : défauts alignés sur {@code server.py}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestPropertySource(properties = "spring.sql.init.data-locations=classpath:test-data-config-defaults.sql")
class PublicConfigEmptyDataIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void bookingUsesPythonDefaultsWhenKeysMissing() throws Exception {
        mockMvc.perform(get("/api/config/booking").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enable_manual_approval_for_services", is(false)))
                .andExpect(jsonPath("$.enable_pay_later_for_services", is(false)))
                .andExpect(jsonPath("$.pay_now_checkout_minutes", is(30)));
    }

    @Test
    void commissionReturnsZerosWhenNoRule() throws Exception {
        mockMvc.perform(get("/api/config/commission").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.has_rule", is(false)))
                .andExpect(jsonPath("$.payer_percent_fee").value(0))
                .andExpect(jsonPath("$.total_percent_fee").value(0));
    }
}
