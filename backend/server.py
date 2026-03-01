from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pathlib import Path
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
from routes.payment_routes import router as payment_router
from routes.admin_routes import router as admin_router
from routes.upload_routes import router as upload_router
from routes.chat_routes import router as chat_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="WINEK API", version="1.0.0")

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(user_router, prefix="/users", tags=["users"])
api_router.include_router(domain_router, tags=["domains"])
api_router.include_router(tagpoint_router, tags=["tagpoints"])
api_router.include_router(service_router, tags=["services"])
api_router.include_router(booking_router, tags=["bookings"])
api_router.include_router(payment_router, tags=["payments"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(chat_router, tags=["chat"])
api_router.include_router(upload_router)

app.include_router(api_router)

# Serve uploaded images at /api/uploads/*
_uploads_dir = ROOT_DIR / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await connect_to_db()
    from seed import seed_initial_data
    await seed_initial_data()
    logger.info("WINEK API started successfully")


@app.on_event("shutdown")
async def shutdown():
    await close_db()
