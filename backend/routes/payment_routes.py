from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import PaymentCheckoutRequest, new_id
from auth_utils import require_auth
from database import get_pool, row_to_dict
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
import os

router = APIRouter()
COMMISSION_RATE = 0.15


def get_stripe_key():
    return os.environ.get("STRIPE_API_KEY", "sk_test_emergent")


@router.post("/payments/checkout")
async def create_checkout(data: PaymentCheckoutRequest, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT booking_id, user_id, coach_id, amount, payment_status FROM bookings WHERE booking_id = $1",
            data.booking_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Booking not found")
    booking = row_to_dict(row)
    if booking["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if booking.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Already paid")

    api_key = get_stripe_key()
    origin = data.origin_url.rstrip("/")
    success_url = f"{origin}/booking/success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={data.booking_id}"
    cancel_url = f"{origin}/booking/{data.booking_id}"
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"

    stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
    checkout_req = CheckoutSessionRequest(
        amount=float(booking["amount"]),
        currency="eur",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "booking_id": data.booking_id,
            "user_id": user["user_id"],
            "coach_id": booking["coach_id"],
        }
    )
    session = await stripe.create_checkout_session(checkout_req)

    async with pool.acquire() as conn:
        tid = new_id("txn")
        await conn.execute(
            """INSERT INTO payment_transactions
               (transaction_id, booking_id, user_id, session_id, amount, currency, status, payment_status, metadata)
               VALUES ($1,$2,$3,$4,$5,'eur','initiated','pending',$6)""",
            tid, data.booking_id, user["user_id"], session.session_id,
            float(booking["amount"]), {"coach_id": booking["coach_id"]}
        )
        await conn.execute(
            "UPDATE bookings SET payment_session_id = $1, updated_at = NOW() WHERE booking_id = $2",
            session.session_id, data.booking_id
        )

    return {"url": session.url, "session_id": session.session_id}


@router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, request: Request):
    pool = get_pool()
    user = await require_auth(request, pool)
    async with pool.acquire() as conn:
        txn_row = await conn.fetchrow(
            "SELECT transaction_id, booking_id, user_id, session_id, amount, status, payment_status FROM payment_transactions WHERE session_id = $1",
            session_id
        )
    if not txn_row:
        raise HTTPException(status_code=404, detail="Transaction not found")
    txn = row_to_dict(txn_row)
    if txn["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if txn["payment_status"] == "paid":
        return txn

    api_key = get_stripe_key()
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"
    stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
    status = await stripe.get_checkout_status(session_id)

    new_status = "completed" if status.payment_status == "paid" else "pending"
    new_payment_status = status.payment_status

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE payment_transactions SET status = $1, payment_status = $2, updated_at = NOW() WHERE session_id = $3",
            new_status, new_payment_status, session_id
        )
        if status.payment_status == "paid":
            await conn.execute(
                "UPDATE bookings SET payment_status = 'paid', status = 'confirmed', updated_at = NOW() WHERE booking_id = $1 AND payment_status != 'paid'",
                txn["booking_id"]
            )

    txn["status"] = new_status
    txn["payment_status"] = new_payment_status
    return txn


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    pool = get_pool()
    body = await request.body()
    api_key = get_stripe_key()
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"
    stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
    try:
        event = await stripe.handle_webhook(body, request.headers.get("Stripe-Signature", ""))
        if event.payment_status == "paid":
            async with pool.acquire() as conn:
                txn_row = await conn.fetchrow(
                    "SELECT transaction_id, booking_id, payment_status FROM payment_transactions WHERE session_id = $1",
                    event.session_id
                )
                if txn_row and txn_row["payment_status"] != "paid":
                    await conn.execute(
                        "UPDATE payment_transactions SET status='completed', payment_status='paid', updated_at=NOW() WHERE session_id=$1",
                        event.session_id
                    )
                    await conn.execute(
                        "UPDATE bookings SET payment_status='paid', status='confirmed', updated_at=NOW() WHERE booking_id=$1",
                        txn_row["booking_id"]
                    )
    except Exception:
        pass
    return {"received": True}
