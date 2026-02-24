from database import get_db
from models import new_id
from auth_utils import hash_password
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

DOMAINS = [
    {"domain_id": "dom_sport", "name": "sport", "label_fr": "Sport & Outdoor", "label_en": "Sport & Outdoor", "icon": "Dumbbell", "color": "#1DBF73", "active": True},
    {"domain_id": "dom_coaching", "name": "coaching", "label_fr": "Coaching", "label_en": "Coaching", "icon": "UserCheck", "color": "#007AFF", "active": True},
    {"domain_id": "dom_service", "name": "service", "label_fr": "Services locaux", "label_en": "Local Services", "icon": "Briefcase", "color": "#FF9500", "active": True},
    {"domain_id": "dom_social", "name": "social", "label_fr": "Social & Communautés", "label_en": "Social & Communities", "icon": "Users", "color": "#FF3B30", "active": True},
]

CATEGORIES = [
    {"category_id": "cat_running", "domain_id": "dom_sport", "name": "running", "label_fr": "Course à pied", "label_en": "Running", "icon": "Footprints", "active": True},
    {"category_id": "cat_football", "domain_id": "dom_sport", "name": "football", "label_fr": "Football", "label_en": "Football", "icon": "Circle", "active": True},
    {"category_id": "cat_basketball", "domain_id": "dom_sport", "name": "basketball", "label_fr": "Basketball", "label_en": "Basketball", "icon": "Circle", "active": True},
    {"category_id": "cat_tennis", "domain_id": "dom_sport", "name": "tennis", "label_fr": "Tennis", "label_en": "Tennis", "icon": "Circle", "active": True},
    {"category_id": "cat_yoga", "domain_id": "dom_sport", "name": "yoga", "label_fr": "Yoga & Méditation", "label_en": "Yoga & Meditation", "icon": "Activity", "active": True},
    {"category_id": "cat_fitness", "domain_id": "dom_sport", "name": "fitness", "label_fr": "Fitness & Musculation", "label_en": "Fitness & Gym", "icon": "Dumbbell", "active": True},
    {"category_id": "cat_cycling", "domain_id": "dom_sport", "name": "cycling", "label_fr": "Vélo & Cyclisme", "label_en": "Cycling", "icon": "Bike", "active": True},
    {"category_id": "cat_swimming", "domain_id": "dom_sport", "name": "swimming", "label_fr": "Natation", "label_en": "Swimming", "icon": "Waves", "active": True},
    {"category_id": "cat_hiking", "domain_id": "dom_sport", "name": "hiking", "label_fr": "Randonnée", "label_en": "Hiking", "icon": "Mountain", "active": True},
    {"category_id": "cat_martial", "domain_id": "dom_sport", "name": "martial_arts", "label_fr": "Arts martiaux", "label_en": "Martial Arts", "icon": "Shield", "active": True},
    {"category_id": "cat_sport_coach", "domain_id": "dom_coaching", "name": "sport_coaching", "label_fr": "Coaching sportif", "label_en": "Sports Coaching", "icon": "UserCheck", "active": True},
    {"category_id": "cat_fitness_coach", "domain_id": "dom_coaching", "name": "fitness_coaching", "label_fr": "Coach fitness", "label_en": "Fitness Coach", "icon": "Dumbbell", "active": True},
    {"category_id": "cat_mental_coach", "domain_id": "dom_coaching", "name": "mental_coaching", "label_fr": "Préparation mentale", "label_en": "Mental Training", "icon": "Brain", "active": True},
]

TAGS = [
    # Running
    {"tag_id": "tag_trail", "category_id": "cat_running", "domain_id": "dom_sport", "name": "trail", "label_fr": "Trail", "label_en": "Trail", "active": True},
    {"tag_id": "tag_route", "category_id": "cat_running", "domain_id": "dom_sport", "name": "route", "label_fr": "Route", "label_en": "Road", "active": True},
    {"tag_id": "tag_5k", "category_id": "cat_running", "domain_id": "dom_sport", "name": "5k", "label_fr": "5km", "label_en": "5k", "active": True},
    {"tag_id": "tag_10k", "category_id": "cat_running", "domain_id": "dom_sport", "name": "10k", "label_fr": "10km", "label_en": "10k", "active": True},
    {"tag_id": "tag_marathon", "category_id": "cat_running", "domain_id": "dom_sport", "name": "marathon", "label_fr": "Marathon", "label_en": "Marathon", "active": True},
    # Football
    {"tag_id": "tag_match_ami", "category_id": "cat_football", "domain_id": "dom_sport", "name": "match_amical", "label_fr": "Match amical", "label_en": "Friendly match", "active": True},
    {"tag_id": "tag_entrainement_foot", "category_id": "cat_football", "domain_id": "dom_sport", "name": "entrainement", "label_fr": "Entraînement", "label_en": "Training", "active": True},
    {"tag_id": "tag_tournoi_foot", "category_id": "cat_football", "domain_id": "dom_sport", "name": "tournoi", "label_fr": "Tournoi", "label_en": "Tournament", "active": True},
    {"tag_id": "tag_futsal", "category_id": "cat_football", "domain_id": "dom_sport", "name": "futsal", "label_fr": "Futsal", "label_en": "Futsal", "active": True},
    # Basketball
    {"tag_id": "tag_match_basket", "category_id": "cat_basketball", "domain_id": "dom_sport", "name": "match_basket", "label_fr": "Match", "label_en": "Game", "active": True},
    {"tag_id": "tag_streetball", "category_id": "cat_basketball", "domain_id": "dom_sport", "name": "streetball", "label_fr": "Streetball", "label_en": "Streetball", "active": True},
    {"tag_id": "tag_3x3", "category_id": "cat_basketball", "domain_id": "dom_sport", "name": "3x3", "label_fr": "3x3", "label_en": "3x3", "active": True},
    # Yoga
    {"tag_id": "tag_hatha", "category_id": "cat_yoga", "domain_id": "dom_sport", "name": "hatha", "label_fr": "Hatha Yoga", "label_en": "Hatha Yoga", "active": True},
    {"tag_id": "tag_vinyasa", "category_id": "cat_yoga", "domain_id": "dom_sport", "name": "vinyasa", "label_fr": "Vinyasa", "label_en": "Vinyasa", "active": True},
    {"tag_id": "tag_meditation", "category_id": "cat_yoga", "domain_id": "dom_sport", "name": "meditation", "label_fr": "Méditation", "label_en": "Meditation", "active": True},
    # Fitness
    {"tag_id": "tag_musculation", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "musculation", "label_fr": "Musculation", "label_en": "Weight training", "active": True},
    {"tag_id": "tag_hiit", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "hiit", "label_fr": "HIIT", "label_en": "HIIT", "active": True},
    {"tag_id": "tag_cardio", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "cardio", "label_fr": "Cardio", "label_en": "Cardio", "active": True},
    {"tag_id": "tag_crossfit", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "crossfit", "label_fr": "CrossFit", "label_en": "CrossFit", "active": True},
    # Cycling
    {"tag_id": "tag_vtt", "category_id": "cat_cycling", "domain_id": "dom_sport", "name": "vtt", "label_fr": "VTT", "label_en": "MTB", "active": True},
    {"tag_id": "tag_route_velo", "category_id": "cat_cycling", "domain_id": "dom_sport", "name": "route_velo", "label_fr": "Route", "label_en": "Road", "active": True},
    # Hiking
    {"tag_id": "tag_balade", "category_id": "cat_hiking", "domain_id": "dom_sport", "name": "balade", "label_fr": "Balade", "label_en": "Walk", "active": True},
    {"tag_id": "tag_grande_randonnee", "category_id": "cat_hiking", "domain_id": "dom_sport", "name": "grande_randonnee", "label_fr": "Grande randonnée", "label_en": "Long hike", "active": True},
    # Martial arts
    {"tag_id": "tag_boxe", "category_id": "cat_martial", "domain_id": "dom_sport", "name": "boxe", "label_fr": "Boxe", "label_en": "Boxing", "active": True},
    {"tag_id": "tag_judo", "category_id": "cat_martial", "domain_id": "dom_sport", "name": "judo", "label_fr": "Judo", "label_en": "Judo", "active": True},
    {"tag_id": "tag_mma", "category_id": "cat_martial", "domain_id": "dom_sport", "name": "mma", "label_fr": "MMA", "label_en": "MMA", "active": True},
    # Coaching
    {"tag_id": "tag_coach_perso", "category_id": "cat_sport_coach", "domain_id": "dom_coaching", "name": "coach_personnel", "label_fr": "Coach personnel", "label_en": "Personal coach", "active": True},
    {"tag_id": "tag_prep_physique", "category_id": "cat_sport_coach", "domain_id": "dom_coaching", "name": "prep_physique", "label_fr": "Prépa physique", "label_en": "Physical prep", "active": True},
    {"tag_id": "tag_perte_poids", "category_id": "cat_fitness_coach", "domain_id": "dom_coaching", "name": "perte_poids", "label_fr": "Perte de poids", "label_en": "Weight loss", "active": True},
    {"tag_id": "tag_prise_masse", "category_id": "cat_fitness_coach", "domain_id": "dom_coaching", "name": "prise_masse", "label_fr": "Prise de masse", "label_en": "Muscle gain", "active": True},
    {"tag_id": "tag_mental_sport", "category_id": "cat_mental_coach", "domain_id": "dom_coaching", "name": "mental_sport", "label_fr": "Mental sportif", "label_en": "Sports mindset", "active": True},
]

ADMIN_USER = {
    "user_id": "user_admin001",
    "email": "admin@winek.app",
    "password_hash": hash_password("WinekAdmin2024!"),
    "name": "Admin WINEK",
    "role": "admin",
    "language": "fr",
    "picture": None,
    "bio": "Administrateur WINEK",
    "is_coach_verified": False,
    "coach_tags": [],
    "hourly_rate": None,
    "created_at": datetime.now(timezone.utc),
    "updated_at": datetime.now(timezone.utc),
}

DEMO_COACH = {
    "user_id": "user_coach001",
    "email": "coach@winek.app",
    "password_hash": hash_password("WinekCoach2024!"),
    "name": "Sophie Martin",
    "role": "coach",
    "language": "fr",
    "picture": None,
    "bio": "Coach sportive certifiée, spécialisée fitness et running. 8 ans d'expérience.",
    "is_coach_verified": True,
    "coach_tags": ["tag_musculation", "tag_hiit", "tag_cardio"],
    "hourly_rate": 60.0,
    "created_at": datetime.now(timezone.utc),
    "updated_at": datetime.now(timezone.utc),
}

DEMO_USER = {
    "user_id": "user_demo001",
    "email": "user@winek.app",
    "password_hash": hash_password("WinekUser2024!"),
    "name": "Thomas Dupont",
    "role": "user",
    "language": "fr",
    "picture": None,
    "bio": "Passionné de sport et de running.",
    "is_coach_verified": False,
    "coach_tags": [],
    "hourly_rate": None,
    "created_at": datetime.now(timezone.utc),
    "updated_at": datetime.now(timezone.utc),
}

DEMO_TAGPOINTS = [
    {
        "point_id": "pt_demo001",
        "user_id": "user_demo001",
        "title": "Footing au Parc de la Villette",
        "description": "Rejoignez-moi pour un footing de 8km autour du parc !",
        "location": {"type": "Point", "coordinates": [2.3933, 48.8936]},
        "precision": "exact",
        "tag_ids": ["tag_route", "tag_10k"],
        "domain_id": "dom_sport",
        "active": True,
        "created_at": datetime.now(timezone.utc),
    },
    {
        "point_id": "pt_demo002",
        "user_id": "user_demo001",
        "title": "Match de basket - Terrain Oberkampf",
        "description": "On cherche des joueurs pour un 3x3, tous niveaux bienvenus.",
        "location": {"type": "Point", "coordinates": [2.3773, 48.8647]},
        "precision": "exact",
        "tag_ids": ["tag_match_basket", "tag_3x3"],
        "domain_id": "dom_sport",
        "active": True,
        "created_at": datetime.now(timezone.utc),
    },
    {
        "point_id": "pt_demo003",
        "user_id": "user_coach001",
        "title": "Yoga en plein air - Trocadéro",
        "description": "Séance de Hatha Yoga tous les matins. Tapis recommandé.",
        "location": {"type": "Point", "coordinates": [2.2895, 48.8619]},
        "precision": "100m",
        "tag_ids": ["tag_hatha", "tag_meditation"],
        "domain_id": "dom_sport",
        "active": True,
        "created_at": datetime.now(timezone.utc),
    },
    {
        "point_id": "pt_demo004",
        "user_id": "user_coach001",
        "title": "CrossFit outdoor - Bois de Vincennes",
        "description": "Entraînement CrossFit intensif en plein air. Niveau intermédiaire.",
        "location": {"type": "Point", "coordinates": [2.4323, 48.8390]},
        "precision": "100m",
        "tag_ids": ["tag_crossfit", "tag_hiit"],
        "domain_id": "dom_sport",
        "active": True,
        "created_at": datetime.now(timezone.utc),
    },
]

DEMO_SERVICE = {
    "service_id": "svc_demo001",
    "coach_id": "user_coach001",
    "title": "Coaching personnalisé - Fitness & Running",
    "description": "Programme sur mesure adapté à vos objectifs. Évaluation initiale incluse.",
    "price": 60.0,
    "duration_min": 60,
    "tag_ids": ["tag_musculation", "tag_cardio", "tag_hiit"],
    "domain_id": "dom_coaching",
    "location": {"type": "Point", "coordinates": [2.3522, 48.8566]},
    "location_description": "Paris - à domicile ou en plein air",
    "max_participants": 1,
    "active": True,
    "created_at": datetime.now(timezone.utc),
}


async def seed_initial_data():
    db = get_db()
    if db is None:
        return

    # Seed domains
    if await db.domains.count_documents({}) == 0:
        await db.domains.insert_many(DOMAINS)
        logger.info("Seeded domains")

    # Seed categories
    if await db.tag_categories.count_documents({}) == 0:
        await db.tag_categories.insert_many(CATEGORIES)
        logger.info("Seeded tag categories")

    # Seed tags
    if await db.tags.count_documents({}) == 0:
        await db.tags.insert_many(TAGS)
        logger.info("Seeded tags")

    # Seed users
    if await db.users.count_documents({}) == 0:
        await db.users.insert_many([ADMIN_USER, DEMO_COACH, DEMO_USER])
        logger.info("Seeded users: admin@winek.app / WinekAdmin2024!, coach@winek.app / WinekCoach2024!, user@winek.app / WinekUser2024!")

    # Seed tag points
    if await db.tag_points.count_documents({}) == 0:
        await db.tag_points.insert_many(DEMO_TAGPOINTS)
        logger.info("Seeded demo tag points")

    # Seed service
    if await db.services.count_documents({}) == 0:
        await db.services.insert_one(DEMO_SERVICE)
        logger.info("Seeded demo service")
