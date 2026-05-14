package com.spotu.modules.config.service;

import com.spotu.modules.config.repository.AppConfigJdbcRepository;
import com.spotu.modules.config.repository.PricingRulesJdbcRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PublicConfigServiceTest {

    @Mock
    private AppConfigJdbcRepository appConfigRepository;

    @Mock
    private PricingRulesJdbcRepository pricingRulesRepository;

    @InjectMocks
    private PublicConfigService publicConfigService;

    @Test
    void bookingParsesTrueFalseAndMinutes() {
        when(appConfigRepository.loadBookingKeys()).thenReturn(Map.of(
                "enable_manual_approval_for_services", "true",
                "enable_pay_later_for_services", "TRUE",
                "pay_now_checkout_minutes", "60"
        ));
        var r = publicConfigService.getBookingConfig();
        assertThat(r.enableManualApprovalForServices()).isTrue();
        assertThat(r.enablePayLaterForServices()).isTrue();
        assertThat(r.payNowCheckoutMinutes()).isEqualTo(60);
    }

    @Test
    void bookingInvalidMinutesFallsBackTo30() {
        when(appConfigRepository.loadBookingKeys()).thenReturn(Map.of(
                "pay_now_checkout_minutes", "not-a-number"
        ));
        var r = publicConfigService.getBookingConfig();
        assertThat(r.payNowCheckoutMinutes()).isEqualTo(30);
    }

    @Test
    void commissionEmptyMatchesPython() {
        when(pricingRulesRepository.findActiveServiceBookingRule()).thenReturn(Optional.empty());
        var r = publicConfigService.getCommissionConfig();
        assertThat(r.hasRule()).isFalse();
        assertThat(r.payerPercentFee()).isZero();
        assertThat(r.totalPercentFee()).isZero();
    }

    @Test
    void commissionRowComputesTotalPercent() {
        var row = new PricingRulesJdbcRepository.CommissionRow(
                BigDecimal.ONE,
                new BigDecimal("2.5"),
                new BigDecimal("3"),
                new BigDecimal("4.5")
        );
        when(pricingRulesRepository.findActiveServiceBookingRule()).thenReturn(Optional.of(row));
        var r = publicConfigService.getCommissionConfig();
        assertThat(r.hasRule()).isTrue();
        assertThat(r.totalPercentFee()).isEqualTo(7.0);
    }
}
