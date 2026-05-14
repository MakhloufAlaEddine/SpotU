package com.spotu;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SpotuApplicationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void contextLoads() {
        // Spring context + Flyway on H2
    }

    @Test
    void livenessReturnsAlive() throws Exception {
        mockMvc.perform(get("/api/liveness").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("alive")));
    }

    @Test
    void readinessReturnsReadyWhenDbUp() throws Exception {
        mockMvc.perform(get("/api/readiness").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("ready")))
                .andExpect(jsonPath("$.database", is("ok")));
    }

    @Test
    void actuatorHealthUp() throws Exception {
        mockMvc.perform(get("/actuator/health").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk());
    }

    @Test
    void bookingConfigReadsDatabase() throws Exception {
        mockMvc.perform(get("/api/config/booking").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enable_manual_approval_for_services", is(true)))
                .andExpect(jsonPath("$.enable_pay_later_for_services", is(false)))
                .andExpect(jsonPath("$.pay_now_checkout_minutes", is(45)));
    }

    @Test
    void commissionConfigReadsDatabase() throws Exception {
        mockMvc.perform(get("/api/config/commission").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.has_rule", is(true)))
                .andExpect(jsonPath("$.payer_percent_fee").value(2.5))
                .andExpect(jsonPath("$.receiver_percent_fee").value(4.5))
                .andExpect(jsonPath("$.total_percent_fee").value(7.0));
    }

    @Test
    void configResponsesDoNotExposeStubFlag() throws Exception {
        mockMvc.perform(get("/api/config/booking")).andExpect(jsonPath("$._stub").doesNotExist());
        mockMvc.perform(get("/api/config/commission")).andExpect(jsonPath("$._stub").doesNotExist());
    }
}
