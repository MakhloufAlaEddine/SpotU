package com.spotu.modules.config.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * Réponse alignée sur {@code public_commission_config} (server.py).
 */
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonPropertyOrder({
        "payer_percent_fee",
        "payer_fixed_fee",
        "receiver_percent_fee",
        "receiver_fixed_fee",
        "total_percent_fee",
        "has_rule"
})
public record CommissionConfigResponse(
        double payerPercentFee,
        double payerFixedFee,
        double receiverPercentFee,
        double receiverFixedFee,
        double totalPercentFee,
        boolean hasRule
) {
    public static CommissionConfigResponse empty() {
        return new CommissionConfigResponse(0, 0, 0, 0, 0, false);
    }
}
