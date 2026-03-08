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
