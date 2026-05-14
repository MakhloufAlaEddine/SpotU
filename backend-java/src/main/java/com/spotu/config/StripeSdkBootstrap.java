package com.spotu.config;

import com.stripe.Stripe;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

/**
 * Initialise le SDK Stripe une fois au démarrage (équivalent {@code _init_stripe()} dans {@code stripe_service.py}).
 */
@Configuration
@Order(Integer.MIN_VALUE)
public class StripeSdkBootstrap {

    private static final Logger log = LoggerFactory.getLogger(StripeSdkBootstrap.class);

    @Value("${stripe.api-key:}")
    private String apiKey;

    /**
     * Si renseigné, force l’URL de base Stripe (équivalent explicite du proxy ; préféré au détecteur {@code sk_test_emergent}).
     */
    @Value("${stripe.api-base-override:}")
    private String apiBaseOverride;

    @PostConstruct
    public void initStripe() {
        String key = apiKey == null ? "" : apiKey;
        Stripe.apiKey = key;

        if (key.isBlank()) {
            log.warn("STRIPE_API_KEY non configurée — les appels Stripe échoueront");
        }

        if (apiBaseOverride != null && !apiBaseOverride.isBlank()) {
            String base = apiBaseOverride.trim();
            Stripe.overrideApiBase(base);
            log.info("Stripe configuré via api-base-override : {}", base);
        } else if (key.contains("sk_test_emergent")) {
            Stripe.overrideApiBase("https://integrations.emergentagent.com/stripe");
            log.info("Stripe configuré via proxy Emergent");
        }
    }
}
