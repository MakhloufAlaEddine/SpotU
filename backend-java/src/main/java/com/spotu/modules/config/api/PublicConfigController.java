package com.spotu.modules.config.api;

import com.spotu.modules.config.dto.BookingConfigResponse;
import com.spotu.modules.config.dto.CommissionConfigResponse;
import com.spotu.modules.config.service.PublicConfigService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Endpoints publics de configuration — alignés sur {@code server.py} (pas d’auth).
 */
@RestController
@RequestMapping("/api/config")
public class PublicConfigController {

    private final PublicConfigService publicConfigService;

    public PublicConfigController(PublicConfigService publicConfigService) {
        this.publicConfigService = publicConfigService;
    }

    @GetMapping("/booking")
    public BookingConfigResponse booking() {
        return publicConfigService.getBookingConfig();
    }

    @GetMapping("/commission")
    public CommissionConfigResponse commission() {
        return publicConfigService.getCommissionConfig();
    }
}
