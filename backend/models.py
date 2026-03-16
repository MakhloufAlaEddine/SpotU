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
    requested        = "requested"        # demande initiale, en attente d'acceptation
    awaiting_payment = "awaiting_payment" # slot bloqué, en attente de paiement
    confirmed        = "confirmed"        # paiement effectué, réservation confirmée
    accepted         = "accepted"         # (legacy) acceptée avant paiement
    refused          = "refused"          # refusée par le bénéficiaire
    expired          = "expired"          # expirée (délai de paiement/acceptation dépassé)
    cancelled        = "cancelled"        # annulée
    completed        = "completed"        # prestation effectuée


class SlotStatus(str, Enum):
    available  = "available"   # créneau libre
    pending    = "pending"     # réservation en attente d'acceptation
    booked     = "booked"      # réservé et accepté
    expired    = "expired"     # passé sans réservation
    cancelled  = "cancelled"   # annulé
    completed  = "completed"   # prestation terminée


class PaymentStatus(str, Enum):
    requires_authorization = "requires_authorization"  # en attente de paiement utilisateur
    authorized             = "authorized"              # session Stripe ouverte
    capture_pending        = "capture_pending"         # autorisation en attente de capture
    captured               = "captured"                # paiement capturé
    cancelled              = "cancelled"               # annulé avant capture
    refunded               = "refunded"                # remboursé après capture
    failed                 = "failed"                  # échec Stripe


# --- AUTH ---
class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    language: Language = Language.fr

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v):
        if len(v) < 6:
            raise ValueError("Le mot de passe doit contenir au moins 6 caractères")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Le nom est obligatoire")
        return v.strip()


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
    sports_level: Optional[str] = None
    goals: Optional[List[str]] = None
    user_roles: Optional[List[str]] = None
    onboarding_done: Optional[bool] = None


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
    minimum_participants: Optional[int] = None
    maximum_participants: Optional[int] = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Le titre est obligatoire")
        return v.strip()

    @field_validator("event_schedule")
    @classmethod
    def validate_schedule_times(cls, v):
        if v and isinstance(v, dict) and v.get("schedule"):
            for day_key, slots in v["schedule"].items():
                if isinstance(slots, list):
                    for slot in slots:
                        # Compatibilité ascendante : format string "HH:MM" ou dict {start, end}
                        if isinstance(slot, str):
                            continue  # Pas de fin à valider sur le format string
                        start = slot.get("start", "")
                        end = slot.get("end", "")
                        if start and end and end <= start:
                            raise ValueError(f"L'heure de fin ({end}) doit être après l'heure de début ({start})")
        return v
        return v


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
    minimum_participants: Optional[int] = None
    maximum_participants: Optional[int] = None


# --- SERVICE ---
class ServiceLocationItem(BaseModel):
    latitude: float
    longitude: float
    precision: Precision = Precision.exact
    description: Optional[str] = None


class DaySlotPayload(BaseModel):
    slot_date: str   # 'YYYY-MM-DD'
    start_time: str  # 'HH:MM'
    end_time: str    # 'HH:MM'

class ServicePackageItem(BaseModel):
    type_id: str
    type_label: str
    duration_min: int = 60
    max_participants: int = 1
    price: float = 0.0
    slots: List[DaySlotPayload] = []


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
    address: Optional[str] = None
    price: Optional[float] = None
    duration_min: Optional[int] = 60
    tag_ids: List[str] = []
    domain_id: Optional[str] = None
    max_participants: Optional[int] = 1
    images: Optional[List[str]] = []
    locations: List[ServiceLocationItem] = []
    packages: List[ServicePackageItem] = []
    slots: List[ServiceSlotItem] = []

    @field_validator("title")
    @classmethod
    def title_min_length(cls, v):
        if not v or len(v.strip()) < 5:
            raise ValueError("Le titre doit avoir au moins 5 caractères")
        return v.strip()

    @field_validator("images")
    @classmethod
    def images_max_count(cls, v):
        if v and len(v) > 5:
            raise ValueError("Maximum 5 images autorisées pour un service")
        return v

    @field_validator("price")
    @classmethod
    def price_positive(cls, v):
        if v is not None and v < 0:
            raise ValueError("Le prix ne peut pas être négatif")
        return v


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
    images: Optional[List[str]] = None
    locations: Optional[List[ServiceLocationItem]] = None
    slots: Optional[List[ServiceSlotItem]] = None
    # Workflow de réservation
    booking_approval_mode: Optional[str] = None       # "manual_approval" | "instant_booking"
    allow_pay_later: Optional[bool] = None
    pay_later_expiration_minutes: Optional[int] = None


# --- PRICING ADMIN ---
class PricingRuleCreate(BaseModel):
    product_type: str
    name: str
    payer_fixed_fee: float = 0.0
    payer_percent_fee: float = 0.0
    receiver_fixed_fee: float = 0.0
    receiver_percent_fee: float = 0.0
    active: bool = True
    priority: int = 0


class SubscriptionPlanCreate(BaseModel):
    name: str
    description: Optional[str] = None
    price: float = 0.0
    duration_days: Optional[int] = None
    exempt_payer_fixed: bool = False
    exempt_payer_percent: bool = False
    exempt_receiver_fixed: bool = False
    exempt_receiver_percent: bool = False
    active: bool = True
    priority: int = 0


# --- BOOKING ---
class BookingRequest(BaseModel):
    """Corps de POST /bookings/request (et alias POST /bookings)."""
    service_id: str
    scheduled_at: Optional[datetime] = None
    slot_id: Optional[str] = None
    location_id: Optional[str] = None
    notes: Optional[str] = None
    idempotency_key: Optional[str] = None
    payment_mode: Optional[str] = "pay_now"   # "pay_now" | "pay_later"


class CancelRequest(BaseModel):
    """Corps optionnel de POST /bookings/{id}/cancel."""
    reason: Optional[str] = None            # Raison libre (non obligatoire)


# Alias rétrocompatibilité (ancien champ BookingCreate toujours importé)
BookingCreate = BookingRequest


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
