from fastapi import FastAPI, APIRouter, Request
from starlette.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from pathlib import Path
from slowapi.errors import RateLimitExceeded
import os
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from database import connect_to_db, close_db
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="SpotU API", version="1.0.0")

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
api_router.include_router(service_router, tags=["services"])
api_router.include_router(booking_router, tags=["bookings"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(chat_router, tags=["chat"])
api_router.include_router(push_router, prefix="/users", tags=["push"])
api_router.include_router(upload_router)
api_router.include_router(payment_router, tags=["payments"])

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
    from seed import seed_initial_data
    await seed_initial_data()

    # ── Démarrage du worker d'expiration des bookings ─────────────────────────
    from database import get_pool
    from expiry_worker import ExpiryWorker
    ttl_hours       = int(os.environ.get("BOOKING_EXPIRY_HOURS", "48"))
    interval_secs   = int(os.environ.get("EXPIRY_WORKER_INTERVAL_SECS", "60"))
    worker = ExpiryWorker(get_pool(), interval_secs=interval_secs)
    worker.start()
    app.state.expiry_worker = worker
    logger.info(
        "SpotU API started successfully (expiry TTL=%dh, worker_interval=%ds)",
        ttl_hours, interval_secs,
    )


@app.on_event("shutdown")
async def shutdown():
    if hasattr(app.state, "expiry_worker"):
        await app.state.expiry_worker.stop()
    await close_db()
