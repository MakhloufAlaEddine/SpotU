package com.spotu.modules.config.api;

import com.spotu.modules.config.dto.BookingConfigResponse;
import com.spotu.modules.config.dto.CommissionConfigResponse;
import com.spotu.modules.config.service.PublicConfigService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.is;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = PublicConfigController.class)
@AutoConfigureMockMvc(addFilters = false)
@ActiveProfiles("test")
class PublicConfigControllerWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private PublicConfigService publicConfigService;

    @Test
    void bookingJsonUsesSnakeCase() throws Exception {
        when(publicConfigService.getBookingConfig()).thenReturn(
                new BookingConfigResponse(true, false, 12));
        mockMvc.perform(get("/api/config/booking").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enable_manual_approval_for_services", is(true)))
                .andExpect(jsonPath("$.pay_now_checkout_minutes", is(12)));
    }

    @Test
    void commissionJsonUsesSnakeCase() throws Exception {
        when(publicConfigService.getCommissionConfig()).thenReturn(
                new CommissionConfigResponse(1, 2, 3, 4, 5, true));
        mockMvc.perform(get("/api/config/commission").accept(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.has_rule", is(true)))
                .andExpect(jsonPath("$.total_percent_fee").value(5));
    }
}
