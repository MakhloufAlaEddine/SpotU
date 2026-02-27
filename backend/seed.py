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
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) VALUES ($1,$2,$3,$4,'coach','fr',$5,TRUE,$6::jsonb,$7) ON CONFLICT DO NOTHING",
                "user_coach001", "coach@winek.app", hash_password("WinekCoach2024!"), "Sophie Martin",
                "Coach sportive certifiée, spécialisée fitness et running. 8 ans d'expérience.",
                json.dumps(["tag_musculation", "tag_hiit", "tag_cardio"]),
                "https://images.pexels.com/photos/1552253/pexels-photo-1552253.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
            )
            # Demo user
            await conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb,$6) ON CONFLICT DO NOTHING",
                "user_demo001", "user@winek.app", hash_password("WinekUser2024!"), "Thomas Dupont",
                "Passionné de sport et de running.",
                "https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
            )
            # Extra demo users
            await conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb,$6) ON CONFLICT DO NOTHING",
                "user_demo002", "mbenali@winek.app", hash_password("WinekDemo2024!"), "Mohamed Benali",
                "Joueur de basket passionné. Fan de streetball et 3x3.",
                "https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
            )
            await conn.execute(
                "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb,$6) ON CONFLICT DO NOTHING",
                "user_demo003", "cdurand@winek.app", hash_password("WinekDemo2024!"), "Camille Durand",
                "Pratiquante de yoga et arts martiaux depuis 10 ans.",
                "https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
            )
            logger.info("Seeded users: admin@winek.app / WinekAdmin2024!, coach@winek.app / WinekCoach2024!, user@winek.app / WinekUser2024!")

        # Tag points
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_points")
        if count == 0:
            demo_points = [
                # (point_id, user_id, title, description, lng, lat, precision, tag_ids_json, domain_id, image_url)
                # --- Sport Paris Centre ---
                ("pt_demo001", "user_demo001",
                 "Footing au Parc de la Villette",
                 "Rejoignez-moi pour un footing de 8km autour du parc, tous les matins à 7h30. Pace 5'30/km. Niveau intermédiaire.",
                 2.3933, 48.8936, "exact",
                 json.dumps(["tag_route", "tag_10k"]), "dom_sport",
                 "https://images.pexels.com/photos/5038834/pexels-photo-5038834.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                ("pt_demo002", "user_demo001",
                 "Match de basket - Terrain Oberkampf",
                 "On cherche des joueurs pour un 3x3 le samedi après-midi. Tous niveaux bienvenus. Terrain en goudron.",
                 2.3773, 48.8647, "exact",
                 json.dumps(["tag_match_basket", "tag_3x3"]), "dom_sport",
                 "https://images.pexels.com/photos/5274806/pexels-photo-5274806.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                ("pt_demo003", "user_coach001",
                 "Yoga en plein air - Trocadéro",
                 "Séance de Hatha Yoga tous les matins face à la Tour Eiffel. Tapis recommandé. Ouvert à tous les niveaux.",
                 2.2895, 48.8619, "100m",
                 json.dumps(["tag_hatha", "tag_meditation"]), "dom_sport",
                 "https://images.unsplash.com/photo-1758274536083-b821befda77c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

                ("pt_demo004", "user_coach001",
                 "CrossFit outdoor - Bois de Vincennes",
                 "Entraînement CrossFit intensif en plein air chaque dimanche à 9h. Niveau intermédiaire à avancé.",
                 2.4323, 48.8390, "100m",
                 json.dumps(["tag_crossfit", "tag_hiit"]), "dom_sport",
                 "https://images.unsplash.com/photo-1760331840426-027b269d0af2?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

                # --- Sport Paris Nord/Est ---
                ("pt_demo005", "user_demo002",
                 "Match de foot 5v5 - Buttes Chaumont",
                 "Recherche joueurs pour match amical 5 contre 5 le mercredi soir à 19h. Synthétique.",
                 2.3850, 48.8771, "exact",
                 json.dumps(["tag_match_ami", "tag_entrainement_foot"]), "dom_sport",
                 "https://images.unsplash.com/photo-1759210720456-c9814f721479?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

                ("pt_demo006", "user_demo002",
                 "Sortie vélo - Canal Saint-Martin",
                 "Balade à vélo le dimanche matin le long du canal. 30km, rythme tranquille. VTT ou route bienvenus.",
                 2.3617, 48.8717, "exact",
                 json.dumps(["tag_vtt", "tag_balade"]), "dom_sport",
                 "https://images.pexels.com/photos/19835454/pexels-photo-19835454.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                ("pt_demo007", "user_demo003",
                 "Boxe & MMA - Belleville",
                 "Session sparring boxe débutant/intermédiaire. Gants fournis. Dans le gymnase de la mairie.",
                 2.3841, 48.8701, "exact",
                 json.dumps(["tag_boxe", "tag_mma"]), "dom_sport",
                 "https://images.pexels.com/photos/6295997/pexels-photo-6295997.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                # --- Sport Paris Sud/Ouest ---
                ("pt_demo008", "user_demo003",
                 "Tennis - Courts de Montmartre",
                 "Partenaire de tennis cherché pour jouer le samedi. Niveau 15/4 environ. Courts rouges.",
                 2.3368, 48.8855, "exact",
                 json.dumps(["tag_match_ami"]), "dom_sport",
                 "https://images.unsplash.com/photo-1766675122854-28fc70f50132?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

                ("pt_demo009", "user_coach001",
                 "Running - Bois de Boulogne",
                 "Groupe de running le mardi et jeudi à 6h45. 10-12km autour du lac. Pace 5'/km. Tous niveaux.",
                 2.2369, 48.8644, "exact",
                 json.dumps(["tag_trail", "tag_10k"]), "dom_sport",
                 "https://images.unsplash.com/photo-1750089440020-58fcbd0f0d89?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

                ("pt_demo010", "user_demo001",
                 "Yoga & Méditation - Parc Monceau",
                 "Vinyasa yoga le matin sous les arbres. Durée 1h. Apporter son tapis. Gratuit.",
                 2.3089, 48.8796, "100m",
                 json.dumps(["tag_vinyasa", "tag_meditation"]), "dom_sport",
                 "https://images.pexels.com/photos/8539083/pexels-photo-8539083.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                # --- Coaching ---
                ("pt_demo011", "user_coach001",
                 "Coach fitness certifiée - Bercy",
                 "Coaching personnalisé fitness, perte de poids et renforcement musculaire. Séance découverte offerte.",
                 2.3795, 48.8382, "1000m",
                 json.dumps(["tag_coach_perso", "tag_perte_poids"]), "dom_coaching",
                 "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                ("pt_demo012", "user_demo002",
                 "Prépa physique football - Stade Charléty",
                 "Programme de préparation physique spécifique football. Explosivité, endurance, prévention blessures.",
                 2.3438, 48.8161, "exact",
                 json.dumps(["tag_prep_physique", "tag_entrainement_foot"]), "dom_coaching",
                 "https://images.unsplash.com/photo-1760331840426-027b269d0af2?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

                # --- Nord Paris ---
                ("pt_demo013", "user_demo003",
                 "Streetball 3x3 - République",
                 "On joue tous les soirs en semaine à partir de 18h. Terrain en asphalte. Bonne ambiance garantie !",
                 2.3631, 48.8675, "exact",
                 json.dumps(["tag_streetball", "tag_3x3"]), "dom_sport",
                 "https://images.pexels.com/photos/1905009/pexels-photo-1905009.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                ("pt_demo014", "user_demo001",
                 "HIIT morning - Sceaux",
                 "Entraînement HIIT intensif dans le parc de Sceaux. 45min non-stop. Cardio + musculation. 7h du matin.",
                 2.2960, 48.7758, "exact",
                 json.dumps(["tag_hiit", "tag_cardio"]), "dom_sport",
                 "https://images.pexels.com/photos/13993895/pexels-photo-13993895.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

                ("pt_demo015", "user_coach001",
                 "Coaching mental sportif - Neuilly",
                 "Séances de préparation mentale pour sportifs. Gestion du stress, confiance en soi, performance.",
                 2.2694, 48.8847, "1000m",
                 json.dumps(["tag_mental_sport", "tag_coach_perso"]), "dom_coaching",
                 "https://images.unsplash.com/photo-1602520628350-fbf9db1f02ae?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),
            ]
            for p in demo_points:
                await conn.execute(
                    """INSERT INTO tag_points (point_id, user_id, title, description, location, precision, tag_ids, domain_id, active, image_url)
                       VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8::jsonb,$9,TRUE,$10) ON CONFLICT DO NOTHING""",
                    p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9]
                )
            logger.info("Seeded demo tag points")

        # ── Always update: dates, schedules, images (relative to NOW) ──────────
        # Format nouveau: schedule = {type:'weekly', schedule:{dayIdx:[{start,end}]}}

        # pt_demo001 – Footing Villette : dans 2 jours à 7h30 → 8h30
        await conn.execute("""UPDATE tag_points SET
            event_date     = DATE_TRUNC('day', NOW() + INTERVAL '2 days') + INTERVAL '7 hours 30 minutes',
            event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '2 days') + INTERVAL '8 hours 30 minutes',
            event_schedule = NULL,
            images = '["https://images.pexels.com/photos/5038834/pexels-photo-5038834.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo001'""")

        # pt_demo002 – Basket Oberkampf : dans 3 jours 15h → 17h
        await conn.execute("""UPDATE tag_points SET
            event_date     = DATE_TRUNC('day', NOW() + INTERVAL '3 days') + INTERVAL '15 hours',
            event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '3 days') + INTERVAL '17 hours',
            event_schedule = NULL,
            images = '["https://images.pexels.com/photos/5274806/pexels-photo-5274806.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo002'""")

        # pt_demo003 – Yoga Trocadéro : récurrent Lun+Mer+Ven 7h30→8h30
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"07:30","end":"08:30"}],"2":[{"start":"07:30","end":"08:30"}],"4":[{"start":"07:30","end":"08:30"}]}}'::jsonb,
            images = '["https://images.unsplash.com/photo-1758274536083-b821befda77c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo003'""")

        # pt_demo004 – CrossFit Vincennes : récurrent Dim 9h→10h30
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"6":[{"start":"09:00","end":"10:30"}]}}'::jsonb,
            images = '["https://images.unsplash.com/photo-1760331840426-027b269d0af2?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo004'""")

        # pt_demo005 – Foot Buttes Chaumont : récurrent Mer 19h→20h30
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"2":[{"start":"19:00","end":"20:30"}]}}'::jsonb,
            images = '["https://images.unsplash.com/photo-1759210720456-c9814f721479?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo005'""")

        # pt_demo006 – Vélo Canal : dans 4 jours 9h → 12h
        await conn.execute("""UPDATE tag_points SET
            event_date     = DATE_TRUNC('day', NOW() + INTERVAL '4 days') + INTERVAL '9 hours',
            event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '4 days') + INTERVAL '12 hours',
            event_schedule = NULL,
            images = '["https://images.pexels.com/photos/19835454/pexels-photo-19835454.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo006'""")

        # pt_demo007 – Boxe Belleville : récurrent Mar+Jeu 19h30→21h
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"1":[{"start":"19:30","end":"21:00"}],"3":[{"start":"19:30","end":"21:00"}]}}'::jsonb,
            images = '["https://images.pexels.com/photos/6295997/pexels-photo-6295997.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo007'""")

        # pt_demo008 – Tennis Montmartre : dans 5 jours 10h → 12h
        await conn.execute("""UPDATE tag_points SET
            event_date     = DATE_TRUNC('day', NOW() + INTERVAL '5 days') + INTERVAL '10 hours',
            event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '5 days') + INTERVAL '12 hours',
            event_schedule = NULL,
            images = '["https://images.unsplash.com/photo-1766675122854-28fc70f50132?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo008'""")

        # pt_demo009 – Running Boulogne : récurrent Mar+Jeu 6h45→8h
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"1":[{"start":"06:45","end":"08:00"}],"3":[{"start":"06:45","end":"08:00"}]}}'::jsonb,
            images = '["https://images.unsplash.com/photo-1750089440020-58fcbd0f0d89?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo009'""")

        # pt_demo010 – Yoga Monceau : récurrent Lun+Mer 8h→9h
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"08:00","end":"09:00"}],"2":[{"start":"08:00","end":"09:00"}]}}'::jsonb,
            images = '["https://images.pexels.com/photos/8539083/pexels-photo-8539083.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo010'""")

        # pt_demo011 – Coach fitness Bercy : sans date (permanent)
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL, event_schedule = NULL,
            images = '["https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo011'""")

        # pt_demo012 – Prépa physique Charléty : récurrent Lun+Ven 18h→19h30
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"18:00","end":"19:30"}],"4":[{"start":"18:00","end":"19:30"}]}}'::jsonb,
            images = '["https://images.unsplash.com/photo-1760331840426-027b269d0af2?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo012'""")

        # pt_demo013 – Streetball République : récurrent Lun-Ven 18h→21h
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"18:00","end":"21:00"}],"1":[{"start":"18:00","end":"21:00"}],"2":[{"start":"18:00","end":"21:00"}],"3":[{"start":"18:00","end":"21:00"}],"4":[{"start":"18:00","end":"21:00"}]}}'::jsonb,
            images = '["https://images.pexels.com/photos/1905009/pexels-photo-1905009.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo013'""")

        # pt_demo014 – HIIT Sceaux : récurrent Lun+Mer+Ven 7h→7h45
        await conn.execute("""UPDATE tag_points SET
            event_date = NULL, event_end_date = NULL,
            event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"07:00","end":"07:45"}],"2":[{"start":"07:00","end":"07:45"}],"4":[{"start":"07:00","end":"07:45"}]}}'::jsonb,
            images = '["https://images.pexels.com/photos/13993895/pexels-photo-13993895.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo014'""")

        # pt_demo015 – Coaching mental Neuilly : dans 4 jours 14h → 15h30
        await conn.execute("""UPDATE tag_points SET
            event_date     = DATE_TRUNC('day', NOW() + INTERVAL '4 days') + INTERVAL '14 hours',
            event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '4 days') + INTERVAL '15 hours 30 minutes',
            event_schedule = NULL,
            images = '["https://images.unsplash.com/photo-1602520628350-fbf9db1f02ae?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo015'""")

        logger.info("Updated event dates and schedules")

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
