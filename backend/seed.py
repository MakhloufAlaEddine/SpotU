from database import get_pool
from auth_utils import hash_password
from datetime import datetime, timezone
import logging
import json

logger = logging.getLogger(__name__)

DOMAINS = [
    {"domain_id": "dom_sport", "name": "sport", "label_fr": "Sport & Outdoor", "label_en": "Sport & Outdoor", "icon": "Dumbbell", "color": "#1DBF73"},
    {"domain_id": "dom_coaching", "name": "coaching", "label_fr": "Coaching", "label_en": "Coaching", "icon": "UserCheck", "color": "#007AFF"},
    {"domain_id": "dom_service", "name": "service", "label_fr": "Services locaux", "label_en": "Local Services", "icon": "Briefcase", "color": "#FF9500"},
    {"domain_id": "dom_social", "name": "social", "label_fr": "Social & Communautés", "label_en": "Social & Communities", "icon": "Users", "color": "#FF3B30"},
]

CATEGORIES = [
    {"category_id": "cat_running", "domain_id": "dom_sport", "name": "running", "label_fr": "Course à pied", "label_en": "Running", "icon": "Footprints"},
    {"category_id": "cat_football", "domain_id": "dom_sport", "name": "football", "label_fr": "Football", "label_en": "Football", "icon": "Circle"},
    {"category_id": "cat_basketball", "domain_id": "dom_sport", "name": "basketball", "label_fr": "Basketball", "label_en": "Basketball", "icon": "Circle"},
    {"category_id": "cat_tennis", "domain_id": "dom_sport", "name": "tennis", "label_fr": "Tennis", "label_en": "Tennis", "icon": "Circle"},
    {"category_id": "cat_yoga", "domain_id": "dom_sport", "name": "yoga", "label_fr": "Yoga & Méditation", "label_en": "Yoga & Meditation", "icon": "Activity"},
    {"category_id": "cat_fitness", "domain_id": "dom_sport", "name": "fitness", "label_fr": "Fitness & Musculation", "label_en": "Fitness & Gym", "icon": "Dumbbell"},
    {"category_id": "cat_cycling", "domain_id": "dom_sport", "name": "cycling", "label_fr": "Vélo & Cyclisme", "label_en": "Cycling", "icon": "Bike"},
    {"category_id": "cat_swimming", "domain_id": "dom_sport", "name": "swimming", "label_fr": "Natation", "label_en": "Swimming", "icon": "Waves"},
    {"category_id": "cat_hiking", "domain_id": "dom_sport", "name": "hiking", "label_fr": "Randonnée", "label_en": "Hiking", "icon": "Mountain"},
    {"category_id": "cat_martial", "domain_id": "dom_sport", "name": "martial_arts", "label_fr": "Arts martiaux", "label_en": "Martial Arts", "icon": "Shield"},
    {"category_id": "cat_sport_coach", "domain_id": "dom_coaching", "name": "sport_coaching", "label_fr": "Coaching sportif", "label_en": "Sports Coaching", "icon": "UserCheck"},
    {"category_id": "cat_fitness_coach", "domain_id": "dom_coaching", "name": "fitness_coaching", "label_fr": "Coach fitness", "label_en": "Fitness Coach", "icon": "Dumbbell"},
    {"category_id": "cat_mental_coach", "domain_id": "dom_coaching", "name": "mental_coaching", "label_fr": "Préparation mentale", "label_en": "Mental Training", "icon": "Brain"},
]

TAGS = [
    {"tag_id": "tag_trail", "category_id": "cat_running", "domain_id": "dom_sport", "name": "trail", "label_fr": "Trail", "label_en": "Trail"},
    {"tag_id": "tag_route", "category_id": "cat_running", "domain_id": "dom_sport", "name": "route", "label_fr": "Route", "label_en": "Road"},
    {"tag_id": "tag_5k", "category_id": "cat_running", "domain_id": "dom_sport", "name": "5k", "label_fr": "5km", "label_en": "5k"},
    {"tag_id": "tag_10k", "category_id": "cat_running", "domain_id": "dom_sport", "name": "10k", "label_fr": "10km", "label_en": "10k"},
    {"tag_id": "tag_marathon", "category_id": "cat_running", "domain_id": "dom_sport", "name": "marathon", "label_fr": "Marathon", "label_en": "Marathon"},
    {"tag_id": "tag_match_ami", "category_id": "cat_football", "domain_id": "dom_sport", "name": "match_amical", "label_fr": "Match amical", "label_en": "Friendly match"},
    {"tag_id": "tag_entrainement_foot", "category_id": "cat_football", "domain_id": "dom_sport", "name": "entrainement", "label_fr": "Entraînement", "label_en": "Training"},
    {"tag_id": "tag_futsal", "category_id": "cat_football", "domain_id": "dom_sport", "name": "futsal", "label_fr": "Futsal", "label_en": "Futsal"},
    {"tag_id": "tag_match_basket", "category_id": "cat_basketball", "domain_id": "dom_sport", "name": "match_basket", "label_fr": "Match", "label_en": "Game"},
    {"tag_id": "tag_streetball", "category_id": "cat_basketball", "domain_id": "dom_sport", "name": "streetball", "label_fr": "Streetball", "label_en": "Streetball"},
    {"tag_id": "tag_3x3", "category_id": "cat_basketball", "domain_id": "dom_sport", "name": "3x3", "label_fr": "3x3", "label_en": "3x3"},
    {"tag_id": "tag_hatha", "category_id": "cat_yoga", "domain_id": "dom_sport", "name": "hatha", "label_fr": "Hatha Yoga", "label_en": "Hatha Yoga"},
    {"tag_id": "tag_vinyasa", "category_id": "cat_yoga", "domain_id": "dom_sport", "name": "vinyasa", "label_fr": "Vinyasa", "label_en": "Vinyasa"},
    {"tag_id": "tag_meditation", "category_id": "cat_yoga", "domain_id": "dom_sport", "name": "meditation", "label_fr": "Méditation", "label_en": "Meditation"},
    {"tag_id": "tag_musculation", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "musculation", "label_fr": "Musculation", "label_en": "Weight training"},
    {"tag_id": "tag_hiit", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "hiit", "label_fr": "HIIT", "label_en": "HIIT"},
    {"tag_id": "tag_cardio", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "cardio", "label_fr": "Cardio", "label_en": "Cardio"},
    {"tag_id": "tag_crossfit", "category_id": "cat_fitness", "domain_id": "dom_sport", "name": "crossfit", "label_fr": "CrossFit", "label_en": "CrossFit"},
    {"tag_id": "tag_vtt", "category_id": "cat_cycling", "domain_id": "dom_sport", "name": "vtt", "label_fr": "VTT", "label_en": "MTB"},
    {"tag_id": "tag_balade", "category_id": "cat_hiking", "domain_id": "dom_sport", "name": "balade", "label_fr": "Balade", "label_en": "Walk"},
    {"tag_id": "tag_grande_randonnee", "category_id": "cat_hiking", "domain_id": "dom_sport", "name": "grande_randonnee", "label_fr": "Grande randonnée", "label_en": "Long hike"},
    {"tag_id": "tag_boxe", "category_id": "cat_martial", "domain_id": "dom_sport", "name": "boxe", "label_fr": "Boxe", "label_en": "Boxing"},
    {"tag_id": "tag_judo", "category_id": "cat_martial", "domain_id": "dom_sport", "name": "judo", "label_fr": "Judo", "label_en": "Judo"},
    {"tag_id": "tag_mma", "category_id": "cat_martial", "domain_id": "dom_sport", "name": "mma", "label_fr": "MMA", "label_en": "MMA"},
    {"tag_id": "tag_coach_perso", "category_id": "cat_sport_coach", "domain_id": "dom_coaching", "name": "coach_personnel", "label_fr": "Coach personnel", "label_en": "Personal coach"},
    {"tag_id": "tag_prep_physique", "category_id": "cat_sport_coach", "domain_id": "dom_coaching", "name": "prep_physique", "label_fr": "Prépa physique", "label_en": "Physical prep"},
    {"tag_id": "tag_perte_poids", "category_id": "cat_fitness_coach", "domain_id": "dom_coaching", "name": "perte_poids", "label_fr": "Perte de poids", "label_en": "Weight loss"},
    {"tag_id": "tag_prise_masse", "category_id": "cat_fitness_coach", "domain_id": "dom_coaching", "name": "prise_masse", "label_fr": "Prise de masse", "label_en": "Muscle gain"},
    {"tag_id": "tag_mental_sport", "category_id": "cat_mental_coach", "domain_id": "dom_coaching", "name": "mental_sport", "label_fr": "Mental sportif", "label_en": "Sports mindset"},
]


async def seed_initial_data():
    pool = get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        # Domains
        count = await conn.fetchval("SELECT COUNT(*) FROM domains")
        if count == 0:
            for d in DOMAINS:
                await conn.execute(
                    "INSERT INTO domains (domain_id, name, label_fr, label_en, icon, color, active) VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT DO NOTHING",
                    d["domain_id"], d["name"], d["label_fr"], d["label_en"], d["icon"], d["color"]
                )
            logger.info("Seeded domains")

        # Categories
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_categories")
        if count == 0:
            for c in CATEGORIES:
                await conn.execute(
                    "INSERT INTO tag_categories (category_id, domain_id, name, label_fr, label_en, icon, active) VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT DO NOTHING",
                    c["category_id"], c["domain_id"], c["name"], c["label_fr"], c["label_en"], c["icon"]
                )
            logger.info("Seeded categories")

        # Tags
        count = await conn.fetchval("SELECT COUNT(*) FROM tags")
        if count == 0:
            for t in TAGS:
                await conn.execute(
                    "INSERT INTO tags (tag_id, category_id, domain_id, name, label_fr, label_en, active) VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT DO NOTHING",
                    t["tag_id"], t["category_id"], t["domain_id"], t["name"], t["label_fr"], t["label_en"]
                )
            logger.info("Seeded tags")

        # Users
        count = await conn.fetchval("SELECT COUNT(*) FROM users")
        if count == 0:
            # Admin
            await conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags) VALUES ($1,$2,$3,$4,'admin','fr',$5,FALSE,'[]'::jsonb) ON CONFLICT DO NOTHING",
                "user_admin001", "admin@winek.app", hash_password("WinekAdmin2024!"), "Admin WINEK", "Administrateur WINEK"
            )
            # Coach
            await conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, hourly_rate) VALUES ($1,$2,$3,$4,'coach','fr',$5,TRUE,$6::jsonb,60.0) ON CONFLICT DO NOTHING",
                "user_coach001", "coach@winek.app", hash_password("WinekCoach2024!"), "Sophie Martin",
                "Coach sportive certifiée, spécialisée fitness et running. 8 ans d'expérience.",
                json.dumps(["tag_musculation", "tag_hiit", "tag_cardio"])
            )
            # Demo user
            await conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags) VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb) ON CONFLICT DO NOTHING",
                "user_demo001", "user@winek.app", hash_password("WinekUser2024!"), "Thomas Dupont",
                "Passionné de sport et de running."
            )
            logger.info("Seeded users: admin@winek.app / WinekAdmin2024!, coach@winek.app / WinekCoach2024!, user@winek.app / WinekUser2024!")

        # Tag points
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_points")
        if count == 0:
            demo_points = [
                ("pt_demo001", "user_demo001", "Footing au Parc de la Villette", "Rejoignez-moi pour un footing de 8km autour du parc !", 2.3933, 48.8936, "exact", json.dumps(["tag_route", "tag_10k"]), "dom_sport"),
                ("pt_demo002", "user_demo001", "Match de basket - Terrain Oberkampf", "On cherche des joueurs pour un 3x3, tous niveaux bienvenus.", 2.3773, 48.8647, "exact", json.dumps(["tag_match_basket", "tag_3x3"]), "dom_sport"),
                ("pt_demo003", "user_coach001", "Yoga en plein air - Trocadéro", "Séance de Hatha Yoga tous les matins. Tapis recommandé.", 2.2895, 48.8619, "100m", json.dumps(["tag_hatha", "tag_meditation"]), "dom_sport"),
                ("pt_demo004", "user_coach001", "CrossFit outdoor - Bois de Vincennes", "Entraînement CrossFit intensif en plein air. Niveau intermédiaire.", 2.4323, 48.8390, "100m", json.dumps(["tag_crossfit", "tag_hiit"]), "dom_sport"),
            ]
            for p in demo_points:
                await conn.execute(
                    "INSERT INTO tag_points (point_id, user_id, title, description, location, precision, tag_ids, domain_id, active) VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8::jsonb,$9,TRUE) ON CONFLICT DO NOTHING",
                    p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8]
                )
            logger.info("Seeded demo tag points")

        # Services
        count = await conn.fetchval("SELECT COUNT(*) FROM services")
        if count == 0:
            await conn.execute(
                "INSERT INTO services (service_id, coach_id, title, description, price, duration_min, tag_ids, domain_id, location, location_description, max_participants, active) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,ST_SetSRID(ST_MakePoint($9,$10),4326),$11,$12,TRUE) ON CONFLICT DO NOTHING",
                "svc_demo001", "user_coach001",
                "Coaching personnalisé - Fitness & Running",
                "Programme sur mesure adapté à vos objectifs. Évaluation initiale incluse.",
                60.0, 60,
                json.dumps(["tag_musculation", "tag_cardio", "tag_hiit"]),
                "dom_coaching",
                2.3522, 48.8566,
                "Paris - à domicile ou en plein air", 1
            )
            logger.info("Seeded demo service")
