package com.spotu.modules.bookings.dto;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

import java.math.BigDecimal;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@JsonPropertyOrder({
        "base_amount",
        "payer_fixed_fee",
        "payer_percent_fee_amount",
        "receiver_fixed_fee",
        "receiver_percent_fee_amount",
        "platform_total_fee",
        "receiver_net_amount",
        "payer_total_amount",
        "currency"
})
public record BookingPricePreviewResponseDto(
        BigDecimal baseAmount,
        BigDecimal payerFixedFee,
        BigDecimal payerPercentFeeAmount,
        BigDecimal receiverFixedFee,
        BigDecimal receiverPercentFeeAmount,
        BigDecimal platformTotalFee,
        BigDecimal receiverNetAmount,
        BigDecimal payerTotalAmount,
        String currency
) {
}
