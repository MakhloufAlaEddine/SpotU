package com.spotu.modules.payments.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.modules.payments.infra.StripeWebhookRepository;
import com.spotu.modules.payments.subscription.SubscriptionWebhookHandler;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static org.assertj.core.api.Assertions.assertThat;

class StripeWebhookSecretProdGuardTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(TestConfig.class);

    @Test
    void prodProfile_withoutSecret_failsFastAtStartup() {
        runner.withPropertyValues("spring.profiles.active=prod")
                .run(ctx -> {
                    assertThat(ctx).hasFailed();
                    assertThat(ctx.getStartupFailure())
                            .hasRootCauseInstanceOf(IllegalStateException.class)
                            .hasRootCauseMessage("STRIPE_WEBHOOK_SECRET est obligatoire en profil prod");
                });
    }

    @Test
    void prodProfile_withSecret_startsSuccessfully() {
        runner.withPropertyValues(
                        "spring.profiles.active=prod",
                        "app.stripe.webhook-secret=whsec_live_test_value"
                )
                .run(ctx -> {
                    assertThat(ctx).hasNotFailed();
                    assertThat(ctx).hasSingleBean(StripeWebhookService.class);
                });
    }

    @Test
    void nonProd_withoutSecret_startsSuccessfully() {
        runner.withPropertyValues("spring.profiles.active=local")
                .run(ctx -> {
                    assertThat(ctx).hasNotFailed();
                    assertThat(ctx).hasSingleBean(StripeWebhookService.class);
                });
    }

    @Configuration
    static class TestConfig {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper();
        }

        @Bean
        StripeWebhookRepository stripeWebhookRepository() {
            return Mockito.mock(StripeWebhookRepository.class);
        }

        @Bean
        PaymentResolverService paymentResolverService() {
            return Mockito.mock(PaymentResolverService.class);
        }

        @Bean
        PaymentEventHandler paymentEventHandler() {
            return Mockito.mock(PaymentEventHandler.class);
        }

        @Bean
        ChargeEventHandler chargeEventHandler() {
            return Mockito.mock(ChargeEventHandler.class);
        }

        @Bean
        SubscriptionWebhookHandler subscriptionWebhookHandler() {
            return Mockito.mock(SubscriptionWebhookHandler.class);
        }

        @Bean
        StripeWebhookService stripeWebhookService(
                ObjectMapper objectMapper,
                StripeWebhookRepository stripeWebhookRepository,
                PaymentResolverService paymentResolverService,
                PaymentEventHandler paymentEventHandler,
                ChargeEventHandler chargeEventHandler,
                SubscriptionWebhookHandler subscriptionWebhookHandler,
                org.springframework.core.env.Environment environment
        ) {
            return new StripeWebhookService(
                    objectMapper,
                    stripeWebhookRepository,
                    paymentResolverService,
                    paymentEventHandler,
                    chargeEventHandler,
                    subscriptionWebhookHandler,
                    environment
            );
        }
    }
}
