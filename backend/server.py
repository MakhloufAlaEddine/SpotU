from fastapi import FastAPI, APIRouter, Request
from starlette.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from pathlib import Path
from slowapi.errors import RateLimitExceeded
import os
import logging
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from database import connect_to_db, close_db, get_pool
from routes.auth_routes import router as auth_router
from routes.user_routes import router as user_router
from routes.domain_routes import router as domain_router
from routes.tagpoint_routes import router as tagpoint_router
from routes.service_routes import router as service_router
from routes.booking_routes import router as booking_router
from routes.admin_routes import router as admin_router
from routes.upload_routes import router as upload_router
from routes.chat_routes import router as chat_router
from routes.push_routes import router as push_router
from routes.payment_routes import router as payment_router
from routes.subscription_routes import router as subscription_router
from routes.spot_you_routes import router as spot_you_router
from routes.home_routes import router as home_router
from routes.address_routes import router as address_router
from routes.marketplace_routes import router as marketplace_router
from routes.product_creation_routes import router as product_creation_router
from routes.admin_product_routes import router as admin_product_router
from routes.deletion_routes import router as deletion_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

import time

app = FastAPI(title="SpotU API", version="1.0.0")


# ── Middleware X-Response-Time ─────────────────────────────────────────────────
@app.middleware("http")
async def add_response_time_header(request: Request, call_next):
    """
    Mesure et expose le temps de traitement de chaque requête HTTP.
    Header ajouté : X-Response-Time (ms, entier)
    Log structuré  : METHOD path → status  XXXms
    Impact runtime : ~1µs par requête (time.perf_counter uniquement).
    """
    t0 = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - t0) * 1000)
    response.headers["X-Response-Time"] = str(elapsed_ms)
    logger.info(
        "%s %s → %s  %dms",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response

# ── [SEC-03] Rate Limiting — slowapi ─────────────────────────────────────────
from limiter import limiter

def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """
    [SEC-03] Gestionnaire 429 personnalisé.
    Ajoute Retry-After en calculant la durée de la fenêtre du rate limit.
    Note : headers_enabled=False sur le limiter — l'injection automatique de
    headers sur les réponses 200 (dicts FastAPI) est incompatible avec slowapi
    qui attend un objet starlette.Response, pas un dict.
    """
    GRANULARITY_SECONDS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}
    granularity_name = "minute"
    try:
        granularity_name = exc.limit.granularity.name if exc.limit else "minute"
    except Exception:
        pass
    retry_after = GRANULARITY_SECONDS.get(granularity_name, 60)
    return JSONResponse(
        {"error": f"Rate limit exceeded: {exc.detail}"},
        status_code=429,
        headers={"Retry-After": str(retry_after)},
    )

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(user_router, prefix="/users", tags=["users"])
api_router.include_router(domain_router, tags=["domains"])
api_router.include_router(tagpoint_router, tags=["tagpoints"])
api_router.include_router(spot_you_router, tags=["spot-you"])
api_router.include_router(home_router, tags=["home"])
api_router.include_router(service_router, tags=["services"])
api_router.include_router(booking_router, tags=["bookings"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(chat_router, tags=["chat"])
api_router.include_router(push_router, prefix="/users", tags=["push"])
api_router.include_router(upload_router)
api_router.include_router(payment_router, tags=["payments"])
api_router.include_router(subscription_router, tags=["subscriptions"])
api_router.include_router(address_router, tags=["addresses"])
api_router.include_router(marketplace_router, tags=["marketplace"])
api_router.include_router(product_creation_router, tags=["products"])
api_router.include_router(admin_product_router, tags=["admin-products"])
api_router.include_router(deletion_router, tags=["deletion"])


# ── Routes infra (liveness / readiness) ──────────────────────────────────────
#
# Liveness  → L'application tourne (process vivant).
#             Utilisé par les orchestrateurs (Kubernetes, Railway…) pour décider
#             s'il faut redémarrer le container.
#             Ne vérifie AUCUNE dépendance externe.
#
# Readiness → L'application EST PRÊTE à recevoir du trafic.
#             Utilisé par les load balancers pour décider si le pod doit
#             recevoir des requêtes. Vérifie la connexion DB.
#             HTTP 200 = prêt | HTTP 503 = pas prêt (enlever du LB)
#
# Règle : un container peut être alive mais not ready (DB indisponible).
#         Ne jamais fusionner les deux sondes.

@api_router.get("/liveness", tags=["infra"])
async def liveness():
    """
    Sonde liveness — vérifie uniquement que le process FastAPI répond.
    Aucune vérification de dépendances (DB, cache, services tiers).
    """
    return {
        "status": "alive",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@api_router.get("/readiness", tags=["infra"])
async def readiness():
    """
    Sonde readiness — vérifie que l'application ET la DB sont prêtes.
    HTTP 200 si tout est OK, HTTP 503 sinon.
    """
    now = datetime.now(timezone.utc).isoformat()
    db_pool = get_pool()

    if db_pool is None:
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "database": "pool_not_initialized",
                "timestamp": now,
            },
        )

    try:
        async with db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return {
            "status": "ready",
            "database": "ok",
            "timestamp": now,
        }
    except Exception as exc:
        logger.warning("Readiness check DB failure: %s", exc)
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "database": f"error: {exc}",
                "timestamp": now,
            },
        )


# ── Endpoint public : configuration des fonctionnalités de réservation ─────────

@api_router.get("/config/booking", tags=["config"])
async def public_booking_config():
    """
    Retourne les flags globaux de réservation (pas d'auth requise).
    Utilisé par le frontend pour adapter l'UI au mode MVP ou avancé.
    """
    from database import get_pool
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT config_key, config_value FROM app_config WHERE config_key IN ('enable_manual_approval_for_services','enable_pay_later_for_services','pay_now_checkout_minutes')"
        )
    cfg = {r["config_key"]: r["config_value"] for r in rows}
    return {
        "enable_manual_approval_for_services": cfg.get("enable_manual_approval_for_services", "false") == "true",
        "enable_pay_later_for_services":       cfg.get("enable_pay_later_for_services", "false") == "true",
        "pay_now_checkout_minutes":            int(cfg.get("pay_now_checkout_minutes", "30")),
    }

@api_router.get("/config/commission", tags=["config"])
async def public_commission_config():
    """
    Retourne le taux de commission actif pour les services (pas d'auth requise).
    Lit la pricing_rule active pour 'service_booking'.
    Si aucune règle n'existe, retourne 0 (pas de commission configurée).
    """
    from database import get_pool
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT payer_fixed_fee, payer_percent_fee,
                      receiver_fixed_fee, receiver_percent_fee
               FROM pricing_rules
               WHERE product_type = 'service_booking' AND active = TRUE
               ORDER BY priority DESC, created_at DESC
               LIMIT 1"""
        )
    if not row:
        return {
            "payer_percent_fee": 0,
            "payer_fixed_fee": 0,
            "receiver_percent_fee": 0,
            "receiver_fixed_fee": 0,
            "total_percent_fee": 0,
            "has_rule": False,
        }
    total_pct = float(row["payer_percent_fee"]) + float(row["receiver_percent_fee"])
    return {
        "payer_percent_fee": float(row["payer_percent_fee"]),
        "payer_fixed_fee": float(row["payer_fixed_fee"]),
        "receiver_percent_fee": float(row["receiver_percent_fee"]),
        "receiver_fixed_fee": float(row["receiver_fixed_fee"]),
        "total_percent_fee": total_pct,
        "has_rule": True,
    }

app.include_router(api_router)

# Serve uploaded images at /api/uploads/*
_uploads_dir = ROOT_DIR / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

# ── [SEC-11] CORS — origines explicites depuis l'environnement ───────────────
# ALLOWED_ORIGINS : liste CSV d'origines autorisées (ex: https://app.exemple.com,http://localhost:3000)
# Ne JAMAIS utiliser ["*"] avec allow_credentials=True (invalide selon la spec CORS).
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _raw_origins:
    _allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
else:
    # Fallback sur APP_URL si ALLOWED_ORIGINS absent — log avertissement
    _app_url = os.environ.get("APP_URL", "").strip()
    _allowed_origins = [_app_url] if _app_url else []
    logger.warning(
        "CORS: ALLOWED_ORIGINS absent du .env — utilisation de APP_URL=%r en fallback. "
        "Définissez ALLOWED_ORIGINS explicitement en production.",
        _app_url or "(vide)",
    )

if not _allowed_origins:
    logger.error("CORS: aucune origine autorisée configurée — toutes les requêtes CORS seront bloquées.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
async def startup():
    await connect_to_db()

    # ── Démarrage du worker d'expiration des bookings ─────────────────────────
    from database import get_pool
    from expiry_worker import ExpiryWorker
    ttl_hours       = int(os.environ.get("BOOKING_EXPIRY_HOURS", "48"))
    interval_secs   = int(os.environ.get("EXPIRY_WORKER_INTERVAL_SECS", "60"))
    worker = ExpiryWorker(get_pool(), interval_secs=interval_secs)
    worker.start()
    app.state.expiry_worker = worker

    # ── Démarrage du worker de notifications SpotYou ──────────────────────────
    from spot_you_notif_worker import SpotYouNotifWorker
    notif_worker = SpotYouNotifWorker(get_pool())
    notif_worker.start()
    app.state.spotyou_notif_worker = notif_worker

    # ── Démarrage du worker de rappel admin produits ───────────────────────────
    from admin_product_reminder_worker import AdminProductReminderWorker
    reminder_worker = AdminProductReminderWorker(get_pool())
    reminder_worker.start()
    app.state.admin_product_reminder_worker = reminder_worker

    # ── Démarrage du worker de purge médias (J+90) ────────────────────────────
    from media_purge_worker import MediaPurgeWorker
    media_purge = MediaPurgeWorker(get_pool())
    media_purge.start()
    app.state.media_purge_worker = media_purge

    # ── Démarrage du worker de notification pré-purge (J+83) ─────────────────
    from media_notif_worker import MediaNotifWorker
    media_notif = MediaNotifWorker(get_pool())
    media_notif.start()
    app.state.media_notif_worker = media_notif

    logger.info(
        "SpotU API started successfully (expiry TTL=%dh, worker_interval=%ds)",
        ttl_hours, interval_secs,
    )


@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "expiry_worker"):
        await app.state.expiry_worker.stop()
    if hasattr(app.state, "spotyou_notif_worker"):
        await app.state.spotyou_notif_worker.stop()
    if hasattr(app.state, "admin_product_reminder_worker"):
        await app.state.admin_product_reminder_worker.stop()
    if hasattr(app.state, "media_purge_worker"):
        await app.state.media_purge_worker.stop()
    if hasattr(app.state, "media_notif_worker"):
        await app.state.media_notif_worker.stop()
    await close_db()
