from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
from models import PaymentCheckoutRequest, new_id
from auth_utils import require_auth
from database import get_db
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
import os

router = APIRouter()
COMMISSION_RATE = 0.15


def get_stripe():
    api_key = os.environ.get("STRIPE_API_KEY", "sk_test_emergent")
    return api_key


@router.post("/payments/checkout")
async def create_checkout(data: PaymentCheckoutRequest, request: Request):
    db = get_db()
    user = await require_auth(request, db)
    booking = await db.bookings.find_one({"booking_id": data.booking_id}, {"_id": 0})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if booking.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Already paid")

    api_key = get_stripe()
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

    # Record transaction
    txn = {
        "transaction_id": new_id("txn"),
        "booking_id": data.booking_id,
        "user_id": user["user_id"],
        "session_id": session.session_id,
        "amount": float(booking["amount"]),
        "currency": "eur",
        "status": "initiated",
        "payment_status": "pending",
        "metadata": {"coach_id": booking["coach_id"]},
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.payment_transactions.insert_one(txn)

    # Update booking with session_id
    await db.bookings.update_one(
        {"booking_id": data.booking_id},
        {"$set": {"payment_session_id": session.session_id, "updated_at": datetime.now(timezone.utc)}}
    )

    return {"url": session.url, "session_id": session.session_id}


@router.get("/payments/status/{session_id}")
async def get_payment_status(session_id: str, request: Request):
    db = get_db()
    user = await require_auth(request, db)

    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Already processed
    if txn["payment_status"] == "paid":
        return txn

    api_key = get_stripe()
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"
    stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)

    status = await stripe.get_checkout_status(session_id)
    new_status = "completed" if status.payment_status == "paid" else "pending"
    new_payment_status = status.payment_status

    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"status": new_status, "payment_status": new_payment_status, "updated_at": datetime.now(timezone.utc)}}
    )

    if status.payment_status == "paid":
        booking_id = txn["booking_id"]
        # Only update once
        booking = await db.bookings.find_one({"booking_id": booking_id})
        if booking and booking.get("payment_status") != "paid":
            await db.bookings.update_one(
                {"booking_id": booking_id},
                {"$set": {"payment_status": "paid", "status": "confirmed", "updated_at": datetime.now(timezone.utc)}}
            )

    txn["status"] = new_status
    txn["payment_status"] = new_payment_status
    return txn


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    db = get_db()
    body = await request.body()
    api_key = get_stripe()
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"
    stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)

    try:
        event = await stripe.handle_webhook(body, request.headers.get("Stripe-Signature", ""))
        if event.payment_status == "paid":
            txn = await db.payment_transactions.find_one({"session_id": event.session_id})
            if txn and txn.get("payment_status") != "paid":
                await db.payment_transactions.update_one(
                    {"session_id": event.session_id},
                    {"$set": {"status": "completed", "payment_status": "paid", "updated_at": datetime.now(timezone.utc)}}
                )
                await db.bookings.update_one(
                    {"booking_id": txn["booking_id"]},
                    {"$set": {"payment_status": "paid", "status": "confirmed", "updated_at": datetime.now(timezone.utc)}}
                )
    except Exception as e:
        pass

    return {"received": True}
