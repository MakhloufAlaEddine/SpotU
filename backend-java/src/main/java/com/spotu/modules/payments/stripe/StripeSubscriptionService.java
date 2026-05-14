package com.spotu.modules.payments.stripe;

import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Price;
import com.stripe.model.Product;
import com.stripe.model.Subscription;
import com.stripe.model.checkout.Session;
import com.stripe.net.RequestOptions;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.CustomerSearchParams;
import com.stripe.param.PriceCreateParams;
import com.stripe.param.PriceListParams;
import com.stripe.param.ProductCreateParams;
import com.stripe.param.ProductSearchParams;
import com.stripe.param.SubscriptionUpdateParams;
import com.stripe.param.checkout.SessionCreateParams;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Appels Stripe abonnements (équivalent {@code stripe_service.py} : customer, price, checkout subscription, cancel).
 */
@Service
public class StripeSubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(StripeSubscriptionService.class);

    private static final Map<Integer, String> DURATION_TO_INTERVAL = Map.of(30, "month", 365, "year");

    public static String durationToInterval(int durationDays) {
        String interval = DURATION_TO_INTERVAL.get(durationDays);
        if (interval == null) {
            String supported = "30j→month, 365j→year";
            throw new IllegalArgumentException(
                    "duration_days=" + durationDays + " non supporté. Valeurs supportées : " + supported
            );
        }
        return interval;
    }

    public String getOrCreateCustomer(String userId, String email, String name) throws StripeException {
        String query = "metadata[\"user_id\"]:\"" + escapeSearchValue(userId) + "\"";
        CustomerSearchParams searchParams = CustomerSearchParams.builder()
                .setQuery(query)
                .setLimit(1L)
                .build();
        var result = Customer.search(searchParams);
        if (result.getData() != null && !result.getData().isEmpty()) {
            return result.getData().get(0).getId();
        }
        CustomerCreateParams createParams = CustomerCreateParams.builder()
                .setEmail(email == null ? "" : email)
                .setName(name == null ? "" : name)
                .putMetadata("user_id", userId)
                .build();
        Customer c = Customer.create(createParams);
        log.info("Stripe Customer créé : {} → {}", userId, c.getId());
        return c.getId();
    }

    /**
     * @return [productId, priceId]
     */
    public String[] ensureSubscriptionPrice(
            String planId,
            String planName,
            String description,
            long amountCents,
            String currency,
            int durationDays
    ) throws StripeException {
        String interval = durationToInterval(durationDays);
        String cur = currency == null || currency.isBlank() ? "eur" : currency.toLowerCase();

        String query = "metadata[\"spotu_plan_id\"]:\"" + escapeSearchValue(planId) + "\"";
        ProductSearchParams psearch = ProductSearchParams.builder().setQuery(query).build();
        var products = Product.search(psearch);

        String productId;
        if (products.getData() != null && !products.getData().isEmpty()) {
            productId = products.getData().get(0).getId();
            log.info("Réutilisation Product Stripe existant : {}", productId);
        } else {
            ProductCreateParams pc = ProductCreateParams.builder()
                    .setName(planName)
                    .setDescription(description == null ? "" : description)
                    .putMetadata("spotu_plan_id", planId)
                    .build();
            Product p = Product.create(pc);
            productId = p.getId();
            log.info("Nouveau Product Stripe créé : {} | plan={}", productId, planId);
        }

        PriceListParams listParams = PriceListParams.builder()
                .setProduct(productId)
                .setActive(true)
                .setLimit(10L)
                .build();
        var prices = Price.list(listParams);

        String priceId = null;
        if (prices.getData() != null) {
            for (Price pr : prices.getData()) {
                if (pr.getUnitAmount() != null
                        && pr.getUnitAmount() == amountCents
                        && pr.getCurrency() != null
                        && pr.getCurrency().equalsIgnoreCase(cur)
                        && pr.getRecurring() != null
                        && interval.equals(pr.getRecurring().getInterval())) {
                    priceId = pr.getId();
                    break;
                }
            }
        }
        if (priceId != null) {
            log.info("Réutilisation Price Stripe existant : {}", priceId);
            return new String[]{productId, priceId};
        }

        PriceCreateParams.Recurring.Interval stripeInterval = "year".equals(interval)
                ? PriceCreateParams.Recurring.Interval.YEAR
                : PriceCreateParams.Recurring.Interval.MONTH;

        PriceCreateParams priceParams = PriceCreateParams.builder()
                .setProduct(productId)
                .setUnitAmount(amountCents)
                .setCurrency(cur)
                .setRecurring(
                        PriceCreateParams.Recurring.builder()
                                .setInterval(stripeInterval)
                                .build()
                )
                .putMetadata("spotu_plan_id", planId)
                .build();
        Price created = Price.create(priceParams);
        log.info("Nouveau Price Stripe créé : {} | {} {} / {}", created.getId(), amountCents, cur, interval);
        return new String[]{productId, created.getId()};
    }

    public Session createSubscriptionCheckoutSession(
            String customerId,
            String priceId,
            String successUrl,
            String cancelUrl,
            Map<String, String> metadata,
            String idempotencyKeyRaw
    ) throws StripeException {
        SessionCreateParams.SubscriptionData.Builder subData = SessionCreateParams.SubscriptionData.builder();
        metadata.forEach(subData::putMetadata);

        SessionCreateParams.Builder b = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.SUBSCRIPTION)
                .setCustomer(customerId)
                .addLineItem(
                        SessionCreateParams.LineItem.builder()
                                .setPrice(priceId)
                                .setQuantity(1L)
                                .build()
                )
                .setSuccessUrl(successUrl)
                .setCancelUrl(cancelUrl)
                .setSubscriptionData(subData.build());
        metadata.forEach(b::putMetadata);

        RequestOptions options = null;
        if (idempotencyKeyRaw != null && !idempotencyKeyRaw.isBlank()) {
            options = RequestOptions.builder()
                    .setIdempotencyKey("sub_cs_" + idempotencyKeyRaw)
                    .build();
        }
        Session session = options == null ? Session.create(b.build()) : Session.create(b.build(), options);
        log.info("Checkout Session abonnement créée : cs={} | customer={}", session.getId(), customerId);
        return session;
    }

    public Session retrieveCheckoutSession(String sessionId) throws StripeException {
        return Session.retrieve(sessionId);
    }

    /**
     * @param atPeriodEnd {@code true} = fin de période (équivalent Python {@code cancel_at_period_end=not immediate})
     */
    public Subscription cancelStripeSubscription(String stripeSubscriptionId, boolean atPeriodEnd) throws StripeException {
        Subscription sub = Subscription.retrieve(stripeSubscriptionId);
        if (atPeriodEnd) {
            Subscription updated = sub.update(
                    SubscriptionUpdateParams.builder().setCancelAtPeriodEnd(true).build()
            );
            log.info("Abonnement Stripe marqué pour annulation : sub={}", stripeSubscriptionId);
            return updated;
        }
        Subscription cancelled = sub.cancel();
        log.info("Abonnement Stripe annulé immédiatement : sub={}", stripeSubscriptionId);
        return cancelled;
    }

    private static String escapeSearchValue(String v) {
        if (v == null) {
            return "";
        }
        return v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
