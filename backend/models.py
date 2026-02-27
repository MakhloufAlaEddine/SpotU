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
    coach_tags: Optional[List[str]] = None
    show_phone: Optional[bool] = None
    show_reviews: Optional[bool] = None
    iban: Optional[str] = None
    bic: Optional[str] = None
    iban_name: Optional[str] = None


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
    event_date: Optional[datetime] = None
    event_end_date: Optional[datetime] = None
    event_schedule: Optional[dict] = None  # { type: "weekly", schedule: {dayIdx: [{start:'HH:MM', end:'HH:MM'}]} }
    images: Optional[List[str]] = []


class TagPointUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    precision: Optional[Precision] = None
    tag_ids: Optional[List[str]] = None
    images: Optional[List[str]] = None
    domain_id: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    active: Optional[bool] = None
    is_public: Optional[bool] = None
    event_date: Optional[datetime] = None
    event_end_date: Optional[datetime] = None
    event_schedule: Optional[dict] = None


# --- SERVICE ---
class ServiceLocationItem(BaseModel):
    latitude: float
    longitude: float
    precision: Precision = Precision.exact
    description: Optional[str] = None


class ServiceSlotItem(BaseModel):
    slot_type: str = 'recurring'  # 'recurring' | 'single' | 'availability'
    location_id: Optional[str] = None   # legacy / direct DB id (ignored in write paths)
    location_index: Optional[int] = None  # index into the locations array (used on create/update)
    raw_schedule: Optional[dict] = None  # full schedule object (source of truth)
    days_of_week: Optional[List[int]] = None  # derived: active days for recurring/availability
    day_of_week: Optional[int] = None   # legacy (compat)
    start_time: str = '00:00'  # 'HH:MM' - primary/first start time
    end_time: str = '00:00'    # 'HH:MM' - primary/first end time
    slot_date: Optional[str] = None   # 'YYYY-MM-DD' pour type single


class ServiceCreate(BaseModel):
    title: str
    description: Optional[str] = None
    price: float
    duration_min: int = 60
    tag_ids: List[str] = []
    domain_id: str
    max_participants: int = 1
    locations: List[ServiceLocationItem] = []
    slots: List[ServiceSlotItem] = []


class ServiceUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    duration_min: Optional[int] = None
    max_participants: Optional[int] = None
    domain_id: Optional[str] = None
    tag_ids: Optional[List[str]] = None
    active: Optional[bool] = None
    location_description: Optional[str] = None
    locations: Optional[List[ServiceLocationItem]] = None
    slots: Optional[List[ServiceSlotItem]] = None


# --- BOOKING ---
class BookingCreate(BaseModel):
    service_id: str
    scheduled_at: Optional[datetime] = None
    slot_id: Optional[str] = None
    location_id: Optional[str] = None
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


class ProfileReviewCreate(BaseModel):
    rating: int
    comment: Optional[str] = None

    @field_validator("rating")
    @classmethod
    def rating_range(cls, v):
        if not 1 <= v <= 5:
            raise ValueError("La note doit être entre 1 et 5")
        return v


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_length(cls, v):
        if len(v) < 6:
            raise ValueError("Le mot de passe doit contenir au moins 6 caractères")
        return v
