"""
stripe_service.py — Wrapper Stripe SDK pour SpotU
==================================================

Responsabilités :
  - Créer / retrouver des Stripe Customers (payers)
  - Créer des PaymentIntents avec capture_method=manual
  - Capturer un PaymentIntent autorisé
  - Annuler une autorisation
  - Vérifier un webhook Stripe
  - Préparer Stripe Connect (Accounts) côté receiver

Toutes les opérations Stripe sont SYNCHRONES (SDK v14).
On les exécute dans asyncio.to_thread() pour ne pas bloquer la boucle.

Variables d'environnement attendues :
  STRIPE_API_KEY              — clé secrète sk_test_... ou sk_live_...
  STRIPE_WEBHOOK_SECRET       — whsec_... (endpoint webhook Stripe)
  STRIPE_CONNECT_CLIENT_ID    — ca_... (Stripe Connect — optionnel)
"""

import stripe
import asyncio
import os
import logging
from functools import partial

log = logging.getLogger("stripe_service")

_STRIPE_KEY    = os.environ.get("STRIPE_API_KEY", "")
_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")


def _init_stripe():
    """Initialise la clé API Stripe (appelé une seule fois au démarrage)."""
    stripe.api_key = _STRIPE_KEY
    if not _STRIPE_KEY:
        log.warning("STRIPE_API_KEY non configurée — les appels Stripe échoueront")
    elif "sk_test_emergent" in _STRIPE_KEY:
        # Clé de test Emergent → proxy géré par Emergent
        stripe.api_base = "https://integrations.emergentagent.com/stripe"
        log.info("Stripe configuré via proxy Emergent")


_init_stripe()


async def _run_sync(fn, *args, **kwargs):
    """Exécute une fonction synchrone Stripe dans un thread dédié."""
    return await asyncio.to_thread(fn, *args, **kwargs)


# ── Customer management ───────────────────────────────────────────────────────

async def get_or_create_customer(user_id: str, email: str, name: str) -> str:
    """
    Crée ou retrouve un Stripe Customer pour un payer.
    Retourne le stripe_customer_id.
    Idempotent : si le customer existe déjà (via metadata.user_id), le réutilise.
    """
    # Chercher un customer existant par metadata
    existing = await _run_sync(
        stripe.Customer.search,
        query=f'metadata["user_id"]:"{user_id}"',
        limit=1,
    )
    if existing.data:
        return existing.data[0].id

    customer = await _run_sync(
        stripe.Customer.create,
        email=email,
        name=name,
        metadata={"user_id": user_id},
    )
    log.info("Stripe Customer créé : %s → %s", user_id, customer.id)
    return customer.id


# ── PaymentIntent — autorisation (capture_method=manual) ─────────────────────

async def create_payment_intent(
    *,
    amount_cents: int,
    currency: str,
    payment_id: str,
    booking_id: str | None = None,
    customer_id: str | None = None,
    receiver_stripe_account: str | None = None,
    platform_fee_cents: int | None = None,
    idempotency_key: str | None = None,
) -> stripe.PaymentIntent:
    """
    Crée un PaymentIntent avec capture_method=manual.

    - amount_cents : payer_total_amount * 100 (depuis le snapshot — jamais recalculé)
    - capture_method=manual : Stripe autorise la carte, ne prélève pas encore
    - Si receiver_stripe_account fourni (Stripe Connect) → transfer_data + application_fee
    - idempotency_key : prévient les doublons sur double appel

    Retourne le PaymentIntent Stripe.
    """
    if amount_cents <= 0:
        raise ValueError(f"amount_cents invalide : {amount_cents}")

    params: dict = {
        "amount":         amount_cents,
        "currency":       currency.lower(),
        "capture_method": "manual",
        "metadata": {
            "payment_id":  payment_id,
            "booking_id":  booking_id or "",
        },
    }

    if customer_id:
        params["customer"] = customer_id

    if receiver_stripe_account:
        params["transfer_data"] = {"destination": receiver_stripe_account}
        if platform_fee_cents and platform_fee_cents > 0:
            params["application_fee_amount"] = platform_fee_cents

    kwargs = {}
    if idempotency_key:
        kwargs["idempotency_key"] = f"pi_{idempotency_key}"

    intent = await _run_sync(stripe.PaymentIntent.create, **params, **kwargs)
    log.info(
        "PaymentIntent créé : pi=%s | payment=%s | amount=%d %s | capture=manual",
        intent.id, payment_id, amount_cents, currency,
    )
    return intent


# ── Capture ────────────────────────────────────────────────────────────────────

async def capture_payment_intent(
    intent_id: str,
    amount_to_capture: int | None = None,
) -> stripe.PaymentIntent:
    """
    Capture un PaymentIntent autorisé (status=requires_capture).
    Appelé lors de l'acceptation du booking.
    - amount_to_capture : si None, capture le montant autorisé (full)
    """
    params = {}
    if amount_to_capture is not None:
        params["amount_to_capture"] = amount_to_capture

    intent = await _run_sync(stripe.PaymentIntent.capture, intent_id, **params)
    log.info("PaymentIntent capturé : pi=%s | status=%s", intent.id, intent.status)
    return intent


# ── Annulation d'autorisation ─────────────────────────────────────────────────

_CANCEL_REASONS = {
    "refused":   "abandoned",
    "expired":   "abandoned",
    "cancelled": "abandoned",
    "duplicate": "duplicate",
    "fraudulent": "fraudulent",
}

async def cancel_payment_intent(
    intent_id: str,
    reason: str = "abandoned",
) -> stripe.PaymentIntent:
    """
    Annule une autorisation PaymentIntent (avant capture).
    Appelé lors du refus, de l'expiration ou de l'annulation du booking.
    reason : 'abandoned' | 'duplicate' | 'fraudulent'
    """
    safe_reason = _CANCEL_REASONS.get(reason, "abandoned")
    intent = await _run_sync(
        stripe.PaymentIntent.cancel,
        intent_id,
        cancellation_reason=safe_reason,
    )
    log.info(
        "PaymentIntent annulé : pi=%s | reason=%s | status=%s",
        intent.id, safe_reason, intent.status,
    )
    return intent


# ── Lecture ────────────────────────────────────────────────────────────────────

async def retrieve_payment_intent(intent_id: str) -> stripe.PaymentIntent:
    """Récupère un PaymentIntent par son ID."""
    return await _run_sync(stripe.PaymentIntent.retrieve, intent_id)


# ── Webhook ───────────────────────────────────────────────────────────────────

def parse_webhook_event(body: bytes, sig: str) -> stripe.Event:
    """
    Vérifie la signature Stripe et retourne l'Event.
    Lève stripe.error.SignatureVerificationError si la signature est invalide.
    Doit être appelé dans un contexte synchrone (pas de await).
    """
    return stripe.Webhook.construct_event(body, sig, _WEBHOOK_SECRET)


# ── Stripe Connect — Onboarding receiver ─────────────────────────────────────

async def create_connect_account(
    user_id: str,
    email: str,
    country: str = "FR",
) -> str:
    """
    Crée un Stripe Connect Account (Express) pour un receiver.
    Retourne le stripe_account_id (acct_...).
    Pas de logique de rôle — tout utilisateur peut devenir receiver.
    """
    account = await _run_sync(
        stripe.Account.create,
        type="express",
        country=country,
        email=email,
        capabilities={"transfers": {"requested": True}},
        metadata={"user_id": user_id},
    )
    log.info("Stripe Connect Account créé : user=%s → %s", user_id, account.id)
    return account.id


async def create_account_link(account_id: str, return_url: str, refresh_url: str) -> str:
    """
    Génère un lien d'onboarding Stripe Connect.
    Retourne l'URL à ouvrir dans le navigateur.
    """
    link = await _run_sync(
        stripe.AccountLink.create,
        account=account_id,
        refresh_url=refresh_url,
        return_url=return_url,
        type="account_onboarding",
    )
    return link.url


# ── Checkout Session (capture manuelle) ──────────────────────────────────────

async def create_checkout_session(
    *,
    amount_cents: int,
    currency: str,
    success_url: str,
    cancel_url: str,
    metadata: dict,
    customer_id: str | None = None,
    idempotency_key: str | None = None,
) -> stripe.checkout.Session:
    """
    Crée une Stripe Checkout Session avec capture_method=manual.

    - Le PaymentIntent est créé automatiquement par Stripe (mode='payment').
    - session.payment_intent contient l'ID du PI (pi_...) disponible immédiatement.
    - Après le checkout, le PI passe en requires_capture (non encore débité).
    - La capture est déclenchée manuellement via capture_payment_intent.

    Retourne l'objet Session Stripe complet.
    """
    if amount_cents <= 0:
        raise ValueError(f"amount_cents invalide : {amount_cents}")

    params: dict = {
        "line_items": [{
            "price_data": {
                "currency": currency.lower(),
                "product_data": {"name": "Réservation de service SpotU"},
                "unit_amount": amount_cents,
            },
            "quantity": 1,
        }],
        "mode": "payment",
        "payment_intent_data": {
            "capture_method": "manual",
            "metadata": metadata,
        },
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": metadata,
    }

    if customer_id:
        params["customer"] = customer_id

    kwargs = {}
    if idempotency_key:
        kwargs["idempotency_key"] = f"cs_{idempotency_key}"

    session = await _run_sync(stripe.checkout.Session.create, **params, **kwargs)
    log.info(
        "Checkout Session créée : cs=%s | pi=%s | amount=%d %s",
        session.id, session.payment_intent, amount_cents, currency,
    )
    return session


async def retrieve_checkout_session(session_id: str) -> stripe.checkout.Session:
    """Récupère une Checkout Session par son ID."""
    return await _run_sync(stripe.checkout.Session.retrieve, session_id)


# ── Stripe Subscriptions ──────────────────────────────────────────────────────

_DURATION_TO_INTERVAL: dict[int, str] = {30: "month", 365: "year"}


def _duration_to_interval(duration_days: int) -> str:
    """
    Mappe une durée en jours vers un intervalle Stripe standard.
    Seuls 30 (mensuel) et 365 (annuel) sont supportés officiellement.
    Lève ValueError pour toute autre valeur.
    """
    interval = _DURATION_TO_INTERVAL.get(duration_days)
    if not interval:
        supported = ", ".join(f"{d}j→{i}" for d, i in _DURATION_TO_INTERVAL.items())
        raise ValueError(
            f"duration_days={duration_days} non supporté. Valeurs supportées : {supported}"
        )
    return interval


async def ensure_subscription_price(
    *,
    plan_id: str,
    plan_name: str,
    description: str | None,
    amount_cents: int,
    currency: str,
    duration_days: int,
) -> tuple[str, str]:
    """
    Crée (ou récupère depuis les métadonnées) le Product + Price Stripe pour un plan.

    Idempotent : si un Product/Price avec les mêmes métadonnées existe déjà,
    il est réutilisé sans re-création (lookup par metadata.spotu_plan_id).

    Args:
        plan_id       : identifiant interne du plan (stocké en metadata)
        plan_name     : libellé du plan (nom du produit Stripe)
        description   : description facultative
        amount_cents  : montant en centimes
        currency      : code devise ISO
        duration_days : 30 (mensuel) ou 365 (annuel)

    Returns:
        (stripe_product_id, stripe_price_id)
    """
    interval = _duration_to_interval(duration_days)

    # Chercher un Product existant par metadata
    products = await _run_sync(
        stripe.Product.search,
        query=f'metadata["spotu_plan_id"]:"{plan_id}"',
    )

    if products.data:
        product = products.data[0]
        product_id = product.id
        log.info("Réutilisation Product Stripe existant : %s", product_id)
    else:
        product = await _run_sync(
            stripe.Product.create,
            name=plan_name,
            description=description or "",
            metadata={"spotu_plan_id": plan_id},
        )
        product_id = product.id
        log.info("Nouveau Product Stripe créé : %s | plan=%s", product_id, plan_id)

    # Chercher un Price actif pour ce Product + interval + montant
    prices = await _run_sync(
        stripe.Price.list,
        product=product_id,
        active=True,
        limit=10,
    )

    matching_price = next(
        (
            p for p in prices.data
            if (
                p.unit_amount == amount_cents
                and p.currency == currency.lower()
                and p.recurring
                and p.recurring.interval == interval
            )
        ),
        None,
    )

    if matching_price:
        price_id = matching_price.id
        log.info("Réutilisation Price Stripe existant : %s", price_id)
    else:
        price = await _run_sync(
            stripe.Price.create,
            product=product_id,
            unit_amount=amount_cents,
            currency=currency.lower(),
            recurring={"interval": interval},
            metadata={"spotu_plan_id": plan_id},
        )
        price_id = price.id
        log.info(
            "Nouveau Price Stripe créé : %s | %d %s / %s",
            price_id, amount_cents, currency, interval,
        )

    return product_id, price_id


async def create_subscription_checkout_session(
    *,
    customer_id: str,
    price_id: str,
    success_url: str,
    cancel_url: str,
    metadata: dict,
    idempotency_key: str | None = None,
) -> stripe.checkout.Session:
    """
    Crée une Checkout Session Stripe en mode 'subscription'.

    - Après le checkout, Stripe crée l'abonnement automatiquement.
    - Le webhook customer.subscription.created + invoice.paid confirme l'activation.
    - session.subscription contient l'ID de l'abonnement Stripe.

    Retourne l'objet Session Stripe complet.
    """
    params: dict = {
        "customer":    customer_id,
        "mode":        "subscription",
        "line_items":  [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url":  cancel_url,
        "metadata":    metadata,
        "subscription_data": {"metadata": metadata},
    }
    kwargs = {}
    if idempotency_key:
        kwargs["idempotency_key"] = f"sub_cs_{idempotency_key}"

    session = await _run_sync(stripe.checkout.Session.create, **params, **kwargs)
    log.info(
        "Checkout Session abonnement créée : cs=%s | customer=%s",
        session.id, customer_id,
    )
    return session


async def cancel_subscription(
    subscription_id: str,
    at_period_end: bool = True,
) -> stripe.Subscription:
    """
    Annule un abonnement Stripe.

    - at_period_end=True  (défaut) : annulation à la fin de la période en cours
    - at_period_end=False          : annulation immédiate (usage admin)

    Retourne l'objet Subscription Stripe mis à jour.
    """
    if at_period_end:
        result = await _run_sync(
            stripe.Subscription.modify,
            subscription_id,
            cancel_at_period_end=True,
        )
    else:
        result = await _run_sync(stripe.Subscription.cancel, subscription_id)

    log.info(
        "Abonnement Stripe %s : sub=%s | at_period_end=%s",
        "marqué pour annulation" if at_period_end else "annulé immédiatement",
        subscription_id, at_period_end,
    )
    return result


async def retrieve_subscription(subscription_id: str) -> stripe.Subscription:
    """Récupère un abonnement Stripe par son ID."""
    return await _run_sync(stripe.Subscription.retrieve, subscription_id)
