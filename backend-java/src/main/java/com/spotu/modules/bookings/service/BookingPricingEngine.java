package com.spotu.modules.bookings.service;

import com.spotu.modules.config.repository.PricingRulesJdbcRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class BookingPricingEngine {

    private final PricingRulesJdbcRepository pricingRulesJdbcRepository;

    public BookingPricingEngine(PricingRulesJdbcRepository pricingRulesJdbcRepository) {
        this.pricingRulesJdbcRepository = pricingRulesJdbcRepository;
    }

    public PricingResult computePricing(String productType, BigDecimal baseAmount, String currency) {
        PricingRulesJdbcRepository.CommissionRow rule = pricingRulesJdbcRepository.findActiveServiceBookingRule().orElse(null);

        BigDecimal safeBase = amount(baseAmount);
        BigDecimal payerFixedFee = BigDecimal.ZERO;
        BigDecimal payerPercentFeeAmount = BigDecimal.ZERO;
        BigDecimal receiverFixedFee = BigDecimal.ZERO;
        BigDecimal receiverPercentFeeAmount = BigDecimal.ZERO;

        if (rule != null) {
            payerFixedFee = amount(rule.payerFixedFee());
            receiverFixedFee = amount(rule.receiverFixedFee());

            BigDecimal payerPercent = amount(rule.payerPercentFee());
            BigDecimal receiverPercent = amount(rule.receiverPercentFee());
            payerPercentFeeAmount = amount(safeBase.multiply(payerPercent).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP));
            receiverPercentFeeAmount = amount(safeBase.multiply(receiverPercent).divide(new BigDecimal("100"), 2, RoundingMode.HALF_UP));
        }

        BigDecimal platformTotalFee = amount(
                payerFixedFee.add(payerPercentFeeAmount).add(receiverFixedFee).add(receiverPercentFeeAmount)
        );
        BigDecimal receiverNetAmount = amount(safeBase.subtract(receiverFixedFee).subtract(receiverPercentFeeAmount));
        BigDecimal payerTotalAmount = amount(safeBase.add(payerFixedFee).add(payerPercentFeeAmount));

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("currency", currency);
        snapshot.put("product_type", productType);
        snapshot.put("base_amount", safeBase);
        snapshot.put("payer_fixed_fee", payerFixedFee);
        snapshot.put("payer_percent_fee_amount", payerPercentFeeAmount);
        snapshot.put("receiver_fixed_fee", receiverFixedFee);
        snapshot.put("receiver_percent_fee_amount", receiverPercentFeeAmount);
        snapshot.put("platform_total_fee", platformTotalFee);
        snapshot.put("receiver_net_amount", receiverNetAmount);
        snapshot.put("payer_total_amount", payerTotalAmount);
        snapshot.put("applied_rules", java.util.List.of());
        snapshot.put("applied_subscription_benefits", java.util.List.of());

        return new PricingResult(
                safeBase,
                payerFixedFee,
                payerPercentFeeAmount,
                receiverFixedFee,
                receiverPercentFeeAmount,
                platformTotalFee,
                receiverNetAmount,
                payerTotalAmount,
                currency,
                productType,
                snapshot
        );
    }

    private static BigDecimal amount(BigDecimal value) {
        return (value == null ? BigDecimal.ZERO : value).setScale(2, RoundingMode.HALF_UP);
    }

    public record PricingResult(
            BigDecimal baseAmount,
            BigDecimal payerFixedFee,
            BigDecimal payerPercentFeeAmount,
            BigDecimal receiverFixedFee,
            BigDecimal receiverPercentFeeAmount,
            BigDecimal platformTotalFee,
            BigDecimal receiverNetAmount,
            BigDecimal payerTotalAmount,
            String currency,
            String productType,
            Map<String, Object> snapshot
    ) {
    }
}
