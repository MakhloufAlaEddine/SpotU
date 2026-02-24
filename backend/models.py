from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime, timezone
from enum import Enum
import uuid


def new_id(prefix: str = "") -> str:
    suffix = uuid.uuid4().hex[:12]
    return f"{prefix}_{suffix}" if prefix else suffix


class UserRole(str, Enum):
    user = "user"
    coach = "coach"
    admin = "admin"


class Language(str, Enum):
    fr = "fr"
    en = "en"


class Precision(str, Enum):
    exact = "exact"
    m100 = "100m"
    m1000 = "1000m"


class BookingStatus(str, Enum):
    pending = "pending"
    confirmed = "confirmed"
    completed = "completed"
    cancelled = "cancelled"


# --- AUTH ---
class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    language: Language = Language.fr


class UserLogin(BaseModel):
    email: str
    password: str


class GoogleAuthRequest(BaseModel):
    session_id: str


# --- USER ---
class UserUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    phone: Optional[str] = None
    language: Optional[Language] = None
    picture: Optional[str] = None
    hourly_rate: Optional[float] = None
    coach_tags: Optional[List[str]] = None


# --- DOMAIN ---
class DomainCreate(BaseModel):
    name: str
    label_fr: str
    label_en: str
    icon: str
    color: str = "#1DBF73"


# --- TAG CATEGORY ---
class TagCategoryCreate(BaseModel):
    domain_id: str
    name: str
    label_fr: str
    label_en: str
    icon: str


# --- TAG ---
class TagCreate(BaseModel):
    category_id: str
    domain_id: str
    name: str
    label_fr: str
    label_en: str
    icon: Optional[str] = None


# --- TAGPOINT ---
class TagPointCreate(BaseModel):
    title: str
    description: Optional[str] = None
    latitude: float
    longitude: float
    precision: Precision = Precision.exact
    tag_ids: List[str] = []
    domain_id: str
    expires_hours: Optional[int] = None


class TagPointUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    precision: Optional[Precision] = None
    tag_ids: Optional[List[str]] = None
    active: Optional[bool] = None


# --- SERVICE ---
class ServiceCreate(BaseModel):
    title: str
    description: Optional[str] = None
    price: float
    duration_min: int = 60
    tag_ids: List[str] = []
    domain_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_description: Optional[str] = None
    max_participants: int = 1


class ServiceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    duration_min: Optional[int] = None
    active: Optional[bool] = None
    location_description: Optional[str] = None


# --- BOOKING ---
class BookingCreate(BaseModel):
    service_id: str
    scheduled_at: Optional[datetime] = None
    notes: Optional[str] = None


class BookingStatusUpdate(BaseModel):
    status: BookingStatus


# --- PAYMENT ---
class PaymentCheckoutRequest(BaseModel):
    booking_id: str
    origin_url: str


# --- REVIEW ---
class ReviewCreate(BaseModel):
    booking_id: str
    rating: int
    comment: Optional[str] = None

    @field_validator("rating")
    @classmethod
    def rating_range(cls, v):
        if not 1 <= v <= 5:
            raise ValueError("Rating must be between 1 and 5")
        return v
