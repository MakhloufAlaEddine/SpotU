package com.spotu.modules.config.service;

import com.spotu.modules.config.dto.BookingConfigResponse;
import com.spotu.modules.config.dto.CommissionConfigResponse;
import com.spotu.modules.config.repository.AppConfigJdbcRepository;
import com.spotu.modules.config.repository.PricingRulesJdbcRepository;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Logique métier des endpoints publics de configuration (parité {@code server.py}).
 */
@Service
public class PublicConfigService {

    private final AppConfigJdbcRepository appConfigRepository;
    private final PricingRulesJdbcRepository pricingRulesRepository;

    public PublicConfigService(
            AppConfigJdbcRepository appConfigRepository,
            PricingRulesJdbcRepository pricingRulesRepository) {
        this.appConfigRepository = appConfigRepository;
        this.pricingRulesRepository = pricingRulesRepository;
    }

    /**
     * Même sémantique que Python : chaînes {@code "true"/"false"}, défauts si clé absente.
     */
    public BookingConfigResponse getBookingConfig() {
        Map<String, String> cfg = appConfigRepository.loadBookingKeys();
        boolean manual = "true".equalsIgnoreCase(cfg.getOrDefault("enable_manual_approval_for_services", "false"));
        boolean payLater = "true".equalsIgnoreCase(cfg.getOrDefault("enable_pay_later_for_services", "false"));
        int minutes = parseIntSafe(cfg.get("pay_now_checkout_minutes"), 30);
        return new BookingConfigResponse(manual, payLater, minutes);
    }

    private static int parseIntSafe(String raw, int defaultValue) {
        if (raw == null || raw.isBlank()) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException ex) {
            return defaultValue;
        }
    }

    /**
     * Même sémantique que Python : pas de ligne → zéros et {@code has_rule: false}.
     */
    public CommissionConfigResponse getCommissionConfig() {
        return pricingRulesRepository.findActiveServiceBookingRule()
                .map(row -> {
                    double payerPct = row.payerPercentFee() != null ? row.payerPercentFee().doubleValue() : 0;
                    double payerFix = row.payerFixedFee() != null ? row.payerFixedFee().doubleValue() : 0;
                    double recvPct = row.receiverPercentFee() != null ? row.receiverPercentFee().doubleValue() : 0;
                    double recvFix = row.receiverFixedFee() != null ? row.receiverFixedFee().doubleValue() : 0;
                    double totalPct = payerPct + recvPct;
                    return new CommissionConfigResponse(payerPct, payerFix, recvPct, recvFix, totalPct, true);
                })
                .orElseGet(CommissionConfigResponse::empty);
    }
}
