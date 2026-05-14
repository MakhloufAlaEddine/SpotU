package com.spotu.modules.payments.stripe;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class StripePaymentServiceMappingTest {

    @Test
    void cancelReason_mapsRefusedExpiredCancelledToAbandoned() {
        Assertions.assertEquals("abandoned", StripePaymentService.mapBusinessCancelReason("refused"));
        Assertions.assertEquals("abandoned", StripePaymentService.mapBusinessCancelReason("expired"));
        Assertions.assertEquals("abandoned", StripePaymentService.mapBusinessCancelReason("cancelled"));
    }

    @Test
    void cancelReason_duplicateAndFraudulentPassthrough() {
        Assertions.assertEquals("duplicate", StripePaymentService.mapBusinessCancelReason("duplicate"));
        Assertions.assertEquals("fraudulent", StripePaymentService.mapBusinessCancelReason("fraudulent"));
    }

    @Test
    void cancelReason_unknownFallback() {
        Assertions.assertEquals("abandoned", StripePaymentService.mapBusinessCancelReason("unknown"));
        Assertions.assertEquals("abandoned", StripePaymentService.mapBusinessCancelReason(null));
        Assertions.assertEquals("abandoned", StripePaymentService.mapBusinessCancelReason(""));
    }

    @Test
    void refundReason_validSet() {
        Assertions.assertEquals("requested_by_customer", StripePaymentService.mapRefundReason("requested_by_customer"));
        Assertions.assertEquals("fraudulent", StripePaymentService.mapRefundReason("fraudulent"));
        Assertions.assertEquals("duplicate", StripePaymentService.mapRefundReason("duplicate"));
    }

    @Test
    void refundReason_invalidFallback() {
        Assertions.assertEquals("requested_by_customer", StripePaymentService.mapRefundReason("bad"));
        Assertions.assertEquals("requested_by_customer", StripePaymentService.mapRefundReason(null));
    }
}
