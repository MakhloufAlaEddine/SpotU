"""
seed.py — Données initiales SpotU / Winek App
Architecture: Domaines → Catégories (entity_type) → Tags (partagés) + liaisons
"""
from database import get_pool
from auth_utils import hash_password
from datetime import datetime, timezone
import logging
import json

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# DOMAINES
# ─────────────────────────────────────────────────────────────────────────────
DOMAINS = [
    {"domain_id": "dom_sport",          "name": "sport",           "label_fr": "Sport & Outdoor",      "label_en": "Sport & Outdoor",      "icon": "barbell-outline",   "color": "#1DBF73"},
    {"domain_id": "dom_coaching",       "name": "coaching",        "label_fr": "Coaching",              "label_en": "Coaching",              "icon": "person-outline",    "color": "#007AFF"},
    {"domain_id": "dom_services_locaux","name": "services_locaux", "label_fr": "Services locaux",       "label_en": "Local Services",        "icon": "briefcase-outline", "color": "#FF9500"},
    {"domain_id": "dom_social",         "name": "social",          "label_fr": "Social & Communautés",  "label_en": "Social & Communities",  "icon": "people-outline",    "color": "#FF3B30"},
]

# ─────────────────────────────────────────────────────────────────────────────
# CATÉGORIES — avec entity_type
# spotyou = écrans SpotYou create/update
# service = écrans Service create/update
# product = écrans Product create/update
# ─────────────────────────────────────────────────────────────────────────────
CATEGORIES = [
    # ── SPOTYOU — sport ──────────────────────────────────────────────────────
    {"category_id": "cat_syu_fitness",       "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "fitness",        "label_fr": "Fitness",              "label_en": "Fitness",          "icon": "barbell-outline"},
    {"category_id": "cat_syu_running",       "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "running",        "label_fr": "Course à pied",        "label_en": "Running",          "icon": "walk-outline"},
    {"category_id": "cat_syu_cycling",       "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "cycling",        "label_fr": "Cyclisme",             "label_en": "Cycling",          "icon": "bicycle-outline"},
    {"category_id": "cat_syu_football",      "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "football",       "label_fr": "Football",             "label_en": "Football",         "icon": "football-outline"},
    {"category_id": "cat_syu_basketball",    "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "basketball",     "label_fr": "Basketball",           "label_en": "Basketball",       "icon": "basketball-outline"},
    {"category_id": "cat_syu_tennis_padel",  "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "tennis_padel",   "label_fr": "Tennis / Padel",       "label_en": "Tennis / Padel",   "icon": "tennisball-outline"},
    {"category_id": "cat_syu_yoga",          "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "yoga",           "label_fr": "Yoga & Méditation",    "label_en": "Yoga & Meditation","icon": "body-outline"},
    {"category_id": "cat_syu_martial_arts",  "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "martial_arts",   "label_fr": "Arts martiaux",        "label_en": "Martial Arts",     "icon": "shield-outline"},
    {"category_id": "cat_syu_hiking",        "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "hiking",         "label_fr": "Randonnée",            "label_en": "Hiking",           "icon": "map-outline"},
    {"category_id": "cat_syu_swimming",      "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "swimming",       "label_fr": "Natation",             "label_en": "Swimming",         "icon": "water-outline"},
    {"category_id": "cat_syu_winter_sports", "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "winter_sports",  "label_fr": "Sports d'hiver",       "label_en": "Winter Sports",    "icon": "snow-outline"},
    {"category_id": "cat_syu_camping",       "domain_id": "dom_sport",           "entity_type": "spotyou", "name": "camping_outdoor","label_fr": "Camping & Outdoor",    "label_en": "Camping & Outdoor","icon": "bonfire-outline"},
    # ── SPOTYOU — coaching ───────────────────────────────────────────────────
    {"category_id": "cat_syu_sport_coach",   "domain_id": "dom_coaching",        "entity_type": "spotyou", "name": "sport_coaching", "label_fr": "Coaching sportif",     "label_en": "Sports Coaching",  "icon": "trophy-outline"},
    {"category_id": "cat_syu_fit_coach",     "domain_id": "dom_coaching",        "entity_type": "spotyou", "name": "fitness_coaching","label_fr": "Coach fitness",        "label_en": "Fitness Coach",    "icon": "barbell-outline"},
    {"category_id": "cat_syu_mental_coach",  "domain_id": "dom_coaching",        "entity_type": "spotyou", "name": "mental_coaching","label_fr": "Préparation mentale",  "label_en": "Mental Coaching",  "icon": "brain-outline" if False else "infinite-outline"},
    {"category_id": "cat_syu_nutrition",     "domain_id": "dom_coaching",        "entity_type": "spotyou", "name": "nutrition",      "label_fr": "Nutrition",            "label_en": "Nutrition",        "icon": "nutrition-outline"},
    {"category_id": "cat_syu_beginner",      "domain_id": "dom_coaching",        "entity_type": "spotyou", "name": "beginner_support","label_fr": "Initiation",          "label_en": "Beginner Support", "icon": "star-outline"},
    # ── SPOTYOU — services locaux ────────────────────────────────────────────
    {"category_id": "cat_syu_local_rental",  "domain_id": "dom_services_locaux", "entity_type": "spotyou", "name": "local_rental",   "label_fr": "Location locale",     "label_en": "Local Rental",     "icon": "key-outline"},
    {"category_id": "cat_syu_local_space",   "domain_id": "dom_services_locaux", "entity_type": "spotyou", "name": "local_space",    "label_fr": "Espace local",        "label_en": "Local Space",      "icon": "home-outline"},
    {"category_id": "cat_syu_local_activity","domain_id": "dom_services_locaux", "entity_type": "spotyou", "name": "local_activity", "label_fr": "Activité locale",     "label_en": "Local Activity",   "icon": "flag-outline"},
    {"category_id": "cat_syu_wellbeing",     "domain_id": "dom_services_locaux", "entity_type": "spotyou", "name": "wellbeing",      "label_fr": "Bien-être",           "label_en": "Wellbeing",        "icon": "flower-outline"},

    # ── SERVICE — sport ───────────────────────────────────────────────────────
    {"category_id": "cat_svc_fitness",       "domain_id": "dom_sport",           "entity_type": "service", "name": "fitness",        "label_fr": "Fitness",              "label_en": "Fitness",          "icon": "barbell-outline"},
    {"category_id": "cat_svc_running",       "domain_id": "dom_sport",           "entity_type": "service", "name": "running",        "label_fr": "Course à pied",        "label_en": "Running",          "icon": "walk-outline"},
    {"category_id": "cat_svc_cycling",       "domain_id": "dom_sport",           "entity_type": "service", "name": "cycling",        "label_fr": "Cyclisme",             "label_en": "Cycling",          "icon": "bicycle-outline"},
    {"category_id": "cat_svc_football",      "domain_id": "dom_sport",           "entity_type": "service", "name": "football",       "label_fr": "Football",             "label_en": "Football",         "icon": "football-outline"},
    {"category_id": "cat_svc_basketball",    "domain_id": "dom_sport",           "entity_type": "service", "name": "basketball",     "label_fr": "Basketball",           "label_en": "Basketball",       "icon": "basketball-outline"},
    {"category_id": "cat_svc_tennis_padel",  "domain_id": "dom_sport",           "entity_type": "service", "name": "tennis_padel",   "label_fr": "Tennis / Padel",       "label_en": "Tennis / Padel",   "icon": "tennisball-outline"},
    {"category_id": "cat_svc_yoga",          "domain_id": "dom_sport",           "entity_type": "service", "name": "yoga",           "label_fr": "Yoga & Méditation",    "label_en": "Yoga & Meditation","icon": "body-outline"},
    {"category_id": "cat_svc_martial_arts",  "domain_id": "dom_sport",           "entity_type": "service", "name": "martial_arts",   "label_fr": "Arts martiaux",        "label_en": "Martial Arts",     "icon": "shield-outline"},
    {"category_id": "cat_svc_hiking",        "domain_id": "dom_sport",           "entity_type": "service", "name": "hiking",         "label_fr": "Randonnée",            "label_en": "Hiking",           "icon": "map-outline"},
    {"category_id": "cat_svc_swimming",      "domain_id": "dom_sport",           "entity_type": "service", "name": "swimming",       "label_fr": "Natation",             "label_en": "Swimming",         "icon": "water-outline"},
    {"category_id": "cat_svc_winter_sports", "domain_id": "dom_sport",           "entity_type": "service", "name": "winter_sports",  "label_fr": "Sports d'hiver",       "label_en": "Winter Sports",    "icon": "snow-outline"},
    {"category_id": "cat_svc_camping",       "domain_id": "dom_sport",           "entity_type": "service", "name": "camping_outdoor","label_fr": "Camping & Outdoor",    "label_en": "Camping & Outdoor","icon": "bonfire-outline"},
    # ── SERVICE — coaching ────────────────────────────────────────────────────
    {"category_id": "cat_svc_sport_coach",   "domain_id": "dom_coaching",        "entity_type": "service", "name": "sport_coaching", "label_fr": "Coaching sportif",     "label_en": "Sports Coaching",  "icon": "trophy-outline"},
    {"category_id": "cat_svc_fit_coach",     "domain_id": "dom_coaching",        "entity_type": "service", "name": "fitness_coaching","label_fr": "Coach fitness",        "label_en": "Fitness Coach",    "icon": "barbell-outline"},
    {"category_id": "cat_svc_mental_coach",  "domain_id": "dom_coaching",        "entity_type": "service", "name": "mental_coaching","label_fr": "Préparation mentale",  "label_en": "Mental Coaching",  "icon": "infinite-outline"},
    {"category_id": "cat_svc_nutrition",     "domain_id": "dom_coaching",        "entity_type": "service", "name": "nutrition",      "label_fr": "Nutrition",            "label_en": "Nutrition",        "icon": "nutrition-outline"},
    {"category_id": "cat_svc_beginner",      "domain_id": "dom_coaching",        "entity_type": "service", "name": "beginner_support","label_fr": "Initiation",          "label_en": "Beginner Support", "icon": "star-outline"},
    # ── SERVICE — services locaux ─────────────────────────────────────────────
    {"category_id": "cat_svc_local_rental",  "domain_id": "dom_services_locaux", "entity_type": "service", "name": "local_rental",   "label_fr": "Location locale",     "label_en": "Local Rental",     "icon": "key-outline"},
    {"category_id": "cat_svc_local_space",   "domain_id": "dom_services_locaux", "entity_type": "service", "name": "local_space",    "label_fr": "Espace local",        "label_en": "Local Space",      "icon": "home-outline"},
    {"category_id": "cat_svc_local_activity","domain_id": "dom_services_locaux", "entity_type": "service", "name": "local_activity", "label_fr": "Activité locale",     "label_en": "Local Activity",   "icon": "flag-outline"},
    {"category_id": "cat_svc_wellbeing",     "domain_id": "dom_services_locaux", "entity_type": "service", "name": "wellbeing",      "label_fr": "Bien-être",           "label_en": "Wellbeing",        "icon": "flower-outline"},

    # ── PRODUCT — sport ───────────────────────────────────────────────────────
    {"category_id": "cat_prd_bike",          "domain_id": "dom_sport",           "entity_type": "product", "name": "bike_scooter",   "label_fr": "Vélo / Trottinette",   "label_en": "Bike / Scooter",   "icon": "bicycle-outline"},
    {"category_id": "cat_prd_racket",        "domain_id": "dom_sport",           "entity_type": "product", "name": "racket_padel",   "label_fr": "Raquette / Padel",     "label_en": "Racket / Padel",   "icon": "tennisball-outline"},
    {"category_id": "cat_prd_fitness_eq",    "domain_id": "dom_sport",           "entity_type": "product", "name": "fitness_equipment","label_fr": "Fitness / Musculation","label_en": "Fitness Equipment","icon": "barbell-outline"},
    {"category_id": "cat_prd_yoga_mat",      "domain_id": "dom_sport",           "entity_type": "product", "name": "yoga_mat",       "label_fr": "Yoga / Tapis",         "label_en": "Yoga / Mat",       "icon": "body-outline"},
    {"category_id": "cat_prd_ball_sports",   "domain_id": "dom_sport",           "entity_type": "product", "name": "ball_sports",    "label_fr": "Sports collectifs",    "label_en": "Ball Sports",      "icon": "football-outline"},
    {"category_id": "cat_prd_swimming_gear", "domain_id": "dom_sport",           "entity_type": "product", "name": "swimming_gear",  "label_fr": "Natation",             "label_en": "Swimming Gear",    "icon": "water-outline"},
    {"category_id": "cat_prd_ski",           "domain_id": "dom_sport",           "entity_type": "product", "name": "ski_snowboard",  "label_fr": "Ski / Snowboard",      "label_en": "Ski / Snowboard",  "icon": "snow-outline"},
    {"category_id": "cat_prd_running_gear",  "domain_id": "dom_sport",           "entity_type": "product", "name": "running_gear",   "label_fr": "Running / Trail",      "label_en": "Running Gear",     "icon": "walk-outline"},
    {"category_id": "cat_prd_martial_gear",  "domain_id": "dom_sport",           "entity_type": "product", "name": "martial_arts_gear","label_fr": "Arts martiaux",       "label_en": "Martial Arts Gear","icon": "shield-outline"},
    {"category_id": "cat_prd_accessories",   "domain_id": "dom_sport",           "entity_type": "product", "name": "sport_accessories","label_fr": "Accessoires sport",   "label_en": "Sport Accessories","icon": "bag-outline"},
    {"category_id": "cat_prd_electronics",   "domain_id": "dom_sport",           "entity_type": "product", "name": "sport_electronics","label_fr": "Électronique sport",  "label_en": "Sport Electronics","icon": "watch-outline"},
    {"category_id": "cat_prd_recovery",      "domain_id": "dom_sport",           "entity_type": "product", "name": "recovery",       "label_fr": "Récupération",         "label_en": "Recovery",         "icon": "medkit-outline"},
    {"category_id": "cat_prd_camping_gear",  "domain_id": "dom_sport",           "entity_type": "product", "name": "camping_gear",   "label_fr": "Camping",              "label_en": "Camping Gear",     "icon": "bonfire-outline"},
    {"category_id": "cat_prd_outdoor_eq",    "domain_id": "dom_sport",           "entity_type": "product", "name": "outdoor_equipment","label_fr": "Outdoor / Randonnée", "label_en": "Outdoor Equipment","icon": "map-outline"},
    # ── PRODUCT — services locaux ─────────────────────────────────────────────
    {"category_id": "cat_prd_equip_rental",  "domain_id": "dom_services_locaux", "entity_type": "product", "name": "equipment_rental","label_fr": "Location matériel",   "label_en": "Equipment Rental", "icon": "key-outline"},
    {"category_id": "cat_prd_space_rental",  "domain_id": "dom_services_locaux", "entity_type": "product", "name": "space_rental",   "label_fr": "Location espace",     "label_en": "Space Rental",     "icon": "home-outline"},
]

# ─────────────────────────────────────────────────────────────────────────────
# TAGS — partagés, domaine-centré (descriptifs/contextuels uniquement)
# ─────────────────────────────────────────────────────────────────────────────
TAGS = [
    # ── Sport ────────────────────────────────────────────────────────────────
    {"tag_id": "tag_hiit",        "domain_id": "dom_sport",    "name": "hiit",        "label_fr": "HIIT",             "label_en": "HIIT"},
    {"tag_id": "tag_cardio",      "domain_id": "dom_sport",    "name": "cardio",      "label_fr": "Cardio",           "label_en": "Cardio"},
    {"tag_id": "tag_crossfit",    "domain_id": "dom_sport",    "name": "crossfit",    "label_fr": "CrossFit",         "label_en": "CrossFit"},
    {"tag_id": "tag_musculation", "domain_id": "dom_sport",    "name": "musculation", "label_fr": "Musculation",      "label_en": "Weight Training"},
    {"tag_id": "tag_running",     "domain_id": "dom_sport",    "name": "running",     "label_fr": "Running",          "label_en": "Running"},
    {"tag_id": "tag_trail",       "domain_id": "dom_sport",    "name": "trail",       "label_fr": "Trail",            "label_en": "Trail"},
    {"tag_id": "tag_marathon",    "domain_id": "dom_sport",    "name": "marathon",    "label_fr": "Marathon",         "label_en": "Marathon"},
    {"tag_id": "tag_10km",        "domain_id": "dom_sport",    "name": "10km",        "label_fr": "10km",             "label_en": "10k"},
    {"tag_id": "tag_5km",         "domain_id": "dom_sport",    "name": "5km",         "label_fr": "5km",              "label_en": "5k"},
    {"tag_id": "tag_football",    "domain_id": "dom_sport",    "name": "football",    "label_fr": "Football",         "label_en": "Football"},
    {"tag_id": "tag_futsal",      "domain_id": "dom_sport",    "name": "futsal",      "label_fr": "Futsal",           "label_en": "Futsal"},
    {"tag_id": "tag_basketball",  "domain_id": "dom_sport",    "name": "basketball",  "label_fr": "Basketball",       "label_en": "Basketball"},
    {"tag_id": "tag_3x3",         "domain_id": "dom_sport",    "name": "3x3",         "label_fr": "3×3",              "label_en": "3x3"},
    {"tag_id": "tag_streetball",  "domain_id": "dom_sport",    "name": "streetball",  "label_fr": "Streetball",       "label_en": "Streetball"},
    {"tag_id": "tag_tennis",      "domain_id": "dom_sport",    "name": "tennis",      "label_fr": "Tennis",           "label_en": "Tennis"},
    {"tag_id": "tag_padel",       "domain_id": "dom_sport",    "name": "padel",       "label_fr": "Padel",            "label_en": "Padel"},
    {"tag_id": "tag_yoga",        "domain_id": "dom_sport",    "name": "yoga",        "label_fr": "Yoga",             "label_en": "Yoga"},
    {"tag_id": "tag_hatha",       "domain_id": "dom_sport",    "name": "hatha",       "label_fr": "Hatha",            "label_en": "Hatha"},
    {"tag_id": "tag_vinyasa",     "domain_id": "dom_sport",    "name": "vinyasa",     "label_fr": "Vinyasa",          "label_en": "Vinyasa"},
    {"tag_id": "tag_meditation",  "domain_id": "dom_sport",    "name": "meditation",  "label_fr": "Méditation",       "label_en": "Meditation"},
    {"tag_id": "tag_boxing",      "domain_id": "dom_sport",    "name": "boxing",      "label_fr": "Boxe",             "label_en": "Boxing"},
    {"tag_id": "tag_judo",        "domain_id": "dom_sport",    "name": "judo",        "label_fr": "Judo",             "label_en": "Judo"},
    {"tag_id": "tag_mma",         "domain_id": "dom_sport",    "name": "mma",         "label_fr": "MMA",              "label_en": "MMA"},
    {"tag_id": "tag_swimming",    "domain_id": "dom_sport",    "name": "swimming",    "label_fr": "Natation",         "label_en": "Swimming"},
    {"tag_id": "tag_hiking",      "domain_id": "dom_sport",    "name": "hiking",      "label_fr": "Randonnée",        "label_en": "Hiking"},
    {"tag_id": "tag_cycling",     "domain_id": "dom_sport",    "name": "cycling",     "label_fr": "Cyclisme",         "label_en": "Cycling"},
    {"tag_id": "tag_vtt",         "domain_id": "dom_sport",    "name": "vtt",         "label_fr": "VTT",              "label_en": "MTB"},
    # ── Camping / Outdoor ─────────────────────────────────────────────────────
    {"tag_id": "tag_camping",          "domain_id": "dom_sport",    "name": "camping",          "label_fr": "Camping",          "label_en": "Camping"},
    {"tag_id": "tag_bivouac",          "domain_id": "dom_sport",    "name": "bivouac",          "label_fr": "Bivouac",          "label_en": "Bivouac"},
    {"tag_id": "tag_trekking",         "domain_id": "dom_sport",    "name": "trekking",         "label_fr": "Trekking",         "label_en": "Trekking"},
    {"tag_id": "tag_survie",           "domain_id": "dom_sport",    "name": "survie",           "label_fr": "Survie",           "label_en": "Survival"},
    {"tag_id": "tag_bushcraft",        "domain_id": "dom_sport",    "name": "bushcraft",        "label_fr": "Bushcraft",        "label_en": "Bushcraft"},
    {"tag_id": "tag_randonnee_longue", "domain_id": "dom_sport",    "name": "randonnee_longue", "label_fr": "Randonnée longue", "label_en": "Long Hike"},
    {"tag_id": "tag_montagne",         "domain_id": "dom_sport",    "name": "montagne",         "label_fr": "Montagne",         "label_en": "Mountain"},
    {"tag_id": "tag_foret",            "domain_id": "dom_sport",    "name": "foret",            "label_fr": "Forêt",            "label_en": "Forest"},
    {"tag_id": "tag_lac",              "domain_id": "dom_sport",    "name": "lac",              "label_fr": "Lac",              "label_en": "Lake"},
    {"tag_id": "tag_mer",              "domain_id": "dom_sport",    "name": "mer",              "label_fr": "Mer",              "label_en": "Sea"},
    {"tag_id": "tag_nature",           "domain_id": "dom_sport",    "name": "nature",           "label_fr": "Nature",           "label_en": "Nature"},
    {"tag_id": "tag_aventure",         "domain_id": "dom_sport",    "name": "aventure",         "label_fr": "Aventure",         "label_en": "Adventure"},
    {"tag_id": "tag_expedition",       "domain_id": "dom_sport",    "name": "expedition",       "label_fr": "Expédition",       "label_en": "Expedition"},
    {"tag_id": "tag_vanlife",          "domain_id": "dom_sport",    "name": "vanlife",          "label_fr": "Vanlife",          "label_en": "Vanlife"},
    {"tag_id": "tag_roadtrip",         "domain_id": "dom_sport",    "name": "roadtrip",         "label_fr": "Roadtrip",         "label_en": "Road Trip"},
    {"tag_id": "tag_autonomie",        "domain_id": "dom_sport",    "name": "autonomie",        "label_fr": "Autonomie",        "label_en": "Self-Sufficiency"},
    {"tag_id": "tag_nuit_exterieure",  "domain_id": "dom_sport",    "name": "nuit_exterieure",  "label_fr": "Nuit extérieure",  "label_en": "Night Outdoors"},
    # ── Coaching ─────────────────────────────────────────────────────────────
    {"tag_id": "tag_perte_poids", "domain_id": "dom_coaching", "name": "perte_de_poids",  "label_fr": "Perte de poids",   "label_en": "Weight Loss"},
    {"tag_id": "tag_prise_masse", "domain_id": "dom_coaching", "name": "prise_de_masse",  "label_fr": "Prise de masse",   "label_en": "Muscle Gain"},
    {"tag_id": "tag_prepa_phys",  "domain_id": "dom_coaching", "name": "prepa_physique",  "label_fr": "Prépa physique",   "label_en": "Physical Prep"},
    {"tag_id": "tag_mental",      "domain_id": "dom_coaching", "name": "mental",          "label_fr": "Mental",           "label_en": "Mental"},
    {"tag_id": "tag_remise_forme","domain_id": "dom_coaching", "name": "remise_en_forme", "label_fr": "Remise en forme",  "label_en": "Fitness Recovery"},
    {"tag_id": "tag_mobilite",    "domain_id": "dom_coaching", "name": "mobilite",        "label_fr": "Mobilité",         "label_en": "Mobility"},
    {"tag_id": "tag_recuperation","domain_id": "dom_coaching", "name": "recuperation",    "label_fr": "Récupération",     "label_en": "Recovery"},
    {"tag_id": "tag_endurance",   "domain_id": "dom_coaching", "name": "endurance",       "label_fr": "Endurance",        "label_en": "Endurance"},
    {"tag_id": "tag_performance", "domain_id": "dom_coaching", "name": "performance",     "label_fr": "Performance",      "label_en": "Performance"},
    # ── Niveau ───────────────────────────────────────────────────────────────
    # (supprimé — tags génériques trop faibles pour le matching)
    # ── Contexte ─────────────────────────────────────────────────────────────
    # (supprimé — indoor/outdoor/matin/soir/weekend/quotidien/competition trop génériques)
    # ── Camping / Outdoor renforcé ────────────────────────────────────────────
    {"tag_id": "tag_camping",          "domain_id": "dom_sport",    "name": "camping",          "label_fr": "Camping",          "label_en": "Camping"},
    {"tag_id": "tag_bivouac",          "domain_id": "dom_sport",    "name": "bivouac",          "label_fr": "Bivouac",          "label_en": "Bivouac"},
    {"tag_id": "tag_trekking",         "domain_id": "dom_sport",    "name": "trekking",         "label_fr": "Trekking",         "label_en": "Trekking"},
    {"tag_id": "tag_survie",           "domain_id": "dom_sport",    "name": "survie",           "label_fr": "Survie",           "label_en": "Survival"},
    {"tag_id": "tag_bushcraft",        "domain_id": "dom_sport",    "name": "bushcraft",        "label_fr": "Bushcraft",        "label_en": "Bushcraft"},
    {"tag_id": "tag_randonnee_longue", "domain_id": "dom_sport",    "name": "randonnee_longue", "label_fr": "Randonnée longue", "label_en": "Long Hike"},
    {"tag_id": "tag_montagne",         "domain_id": "dom_sport",    "name": "montagne",         "label_fr": "Montagne",         "label_en": "Mountain"},
    {"tag_id": "tag_foret",            "domain_id": "dom_sport",    "name": "foret",            "label_fr": "Forêt",            "label_en": "Forest"},
    {"tag_id": "tag_lac",              "domain_id": "dom_sport",    "name": "lac",              "label_fr": "Lac",              "label_en": "Lake"},
    {"tag_id": "tag_mer",              "domain_id": "dom_sport",    "name": "mer",              "label_fr": "Mer",              "label_en": "Sea"},
    {"tag_id": "tag_nature",           "domain_id": "dom_sport",    "name": "nature",           "label_fr": "Nature",           "label_en": "Nature"},
    {"tag_id": "tag_aventure",         "domain_id": "dom_sport",    "name": "aventure",         "label_fr": "Aventure",         "label_en": "Adventure"},
    {"tag_id": "tag_expedition",       "domain_id": "dom_sport",    "name": "expedition",       "label_fr": "Expédition",       "label_en": "Expedition"},
    {"tag_id": "tag_vanlife",          "domain_id": "dom_sport",    "name": "vanlife",          "label_fr": "Vanlife",          "label_en": "Vanlife"},
    {"tag_id": "tag_roadtrip",         "domain_id": "dom_sport",    "name": "roadtrip",         "label_fr": "Roadtrip",         "label_en": "Road Trip"},
    {"tag_id": "tag_autonomie",        "domain_id": "dom_sport",    "name": "autonomie",        "label_fr": "Autonomie",        "label_en": "Self-Sufficiency"},
    {"tag_id": "tag_nuit_exterieure",  "domain_id": "dom_sport",    "name": "nuit_exterieure",  "label_fr": "Nuit extérieure",  "label_en": "Night Outdoors"},
]

# ─────────────────────────────────────────────────────────────────────────────
# LIAISONS TAG ↔ CATÉGORIES (tag_category_links)
# Un tag peut appartenir à plusieurs catégories (spotyou + service + product)
# ─────────────────────────────────────────────────────────────────────────────
def _build_tag_category_links():
    links = []

    def add(tag_id, *cat_ids):
        for cid in cat_ids:
            links.append({"tag_id": tag_id, "category_id": cid})

    # fitness tags
    for t in ["tag_hiit", "tag_cardio", "tag_crossfit", "tag_musculation"]:
        add(t, "cat_syu_fitness", "cat_svc_fitness", "cat_prd_fitness_eq")
    # running tags
    for t in ["tag_running", "tag_trail", "tag_marathon", "tag_10km", "tag_5km", "tag_endurance"]:
        add(t, "cat_syu_running", "cat_svc_running", "cat_prd_running_gear")
    # cycling
    for t in ["tag_cycling", "tag_vtt"]:
        add(t, "cat_syu_cycling", "cat_svc_cycling", "cat_prd_bike")
    # football
    for t in ["tag_football", "tag_futsal"]:
        add(t, "cat_syu_football", "cat_svc_football", "cat_prd_ball_sports")
    # basketball
    for t in ["tag_basketball", "tag_3x3", "tag_streetball"]:
        add(t, "cat_syu_basketball", "cat_svc_basketball", "cat_prd_ball_sports")
    # tennis/padel
    for t in ["tag_tennis", "tag_padel"]:
        add(t, "cat_syu_tennis_padel", "cat_svc_tennis_padel", "cat_prd_racket")
    # yoga
    for t in ["tag_yoga", "tag_hatha", "tag_vinyasa", "tag_meditation", "tag_mobilite"]:
        add(t, "cat_syu_yoga", "cat_svc_yoga", "cat_prd_yoga_mat")
    # martial arts
    for t in ["tag_boxing", "tag_judo", "tag_mma"]:
        add(t, "cat_syu_martial_arts", "cat_svc_martial_arts", "cat_prd_martial_gear")
    # hiking
    for t in ["tag_hiking", "tag_nature", "tag_montagne", "tag_foret", "tag_aventure"]:
        add(t, "cat_syu_hiking", "cat_svc_hiking", "cat_prd_outdoor_eq")
    # swimming
    add("tag_swimming", "cat_syu_swimming", "cat_svc_swimming", "cat_prd_swimming_gear")
    # camping/outdoor
    for t in ["tag_camping", "tag_bivouac", "tag_trekking", "tag_survie",
              "tag_bushcraft", "tag_vanlife", "tag_roadtrip"]:
        add(t, "cat_syu_camping", "cat_svc_camping", "cat_prd_camping_gear")
    # coaching tags
    for t in ["tag_perte_poids", "tag_prise_masse", "tag_prepa_phys", "tag_performance"]:
        add(t, "cat_syu_sport_coach", "cat_svc_sport_coach")
    for t in ["tag_remise_forme", "tag_recuperation", "tag_mobilite", "tag_endurance"]:
        add(t, "cat_syu_fit_coach", "cat_svc_fit_coach")
    add("tag_mental", "cat_syu_mental_coach", "cat_svc_mental_coach")

    # Deduplicate
    seen = set()
    result = []
    for lnk in links:
        key = (lnk["tag_id"], lnk["category_id"])
        if key not in seen:
            seen.add(key)
            result.append(lnk)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# LIAISONS TAG ↔ ENTITY_TYPE (tag_entity_type_links)
# ─────────────────────────────────────────────────────────────────────────────
def _build_tag_entity_type_links():
    """Derive entity_type links from category links."""
    links = []
    cat_entity = {c["category_id"]: c["entity_type"] for c in CATEGORIES}
    seen = set()
    for lnk in _build_tag_category_links():
        et = cat_entity.get(lnk["category_id"])
        if et:
            key = (lnk["tag_id"], et)
            if key not in seen:
                seen.add(key)
                links.append({"tag_id": lnk["tag_id"], "entity_type": et})
    return links


# ─────────────────────────────────────────────────────────────────────────────
# DONNÉES DE TEST
# ─────────────────────────────────────────────────────────────────────────────
def _spotyou_data():
    return [
        # (point_id, user_id, title, description, lng, lat, precision, tag_ids_json, domain_id, image_url)
        ("pt_demo001", "user_demo001",
         "HIIT morning — Parc de Sceaux",
         "Entraînement HIIT intensif 45 min dans le parc. Cardio + musculation. 7h du matin, tous niveaux bienvenus.",
         2.2960, 48.7758, "exact",
         ["tag_hiit", "tag_cardio", "tag_outdoor", "tag_matin"], "dom_sport",
         "https://images.pexels.com/photos/13993895/pexels-photo-13993895.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

        ("pt_demo002", "user_demo001",
         "Running trail — Bois de Boulogne",
         "Groupe de running trail le mardi et jeudi à 6h45. 10-12 km. Pace 5'/km. Tous niveaux.",
         2.2369, 48.8644, "exact",
         ["tag_trail", "tag_running", "tag_10km", "tag_matin"], "dom_sport",
         "https://images.unsplash.com/photo-1750089440020-58fcbd0f0d89?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

        ("pt_demo003", "user_coach001",
         "Yoga en plein air — Trocadéro",
         "Séance Hatha Yoga tous les matins face à la Tour Eiffel. Tapis recommandé. Ouvert à tous.",
         2.2895, 48.8619, "100m",
         ["tag_yoga", "tag_hatha", "tag_meditation", "tag_outdoor"], "dom_sport",
         "https://images.unsplash.com/photo-1758274536083-b821befda77c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"),

        ("pt_demo004", "user_demo002",
         "Sortie randonnée — Forêt de Fontainebleau",
         "Randonnée de 15 km en forêt. Départ parking Gorges d'Apremont. Niveau intermédiaire.",
         2.6500, 48.3900, "exact",
         ["tag_hiking", "tag_nature", "tag_foret", "tag_weekend"], "dom_sport",
         "https://images.pexels.com/photos/19835454/pexels-photo-19835454.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),

        ("pt_demo005", "user_demo003",
         "Session camping & bivouac — Chevreuse",
         "Week-end bushcraft dans la vallée de Chevreuse. Techniques de survie, feu, abri. Matériel fourni.",
         2.0382, 48.7040, "1000m",
         ["tag_camping", "tag_bivouac", "tag_bushcraft", "tag_nature"], "dom_sport",
         "https://images.pexels.com/photos/5038834/pexels-photo-5038834.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ]


def _services_data():
    return [
        # (service_id, coach_id, title, description, price, tag_ids_json, domain_id, lng, lat, address, loc_desc, images_json)
        ("svc_demo001", "user_coach001",
         "Coaching perte de poids",
         "Programme sur mesure adapté à vos objectifs. Bilan initial + suivi hebdomadaire. 8 ans d'expérience certifiée.",
         60.0,
         ["tag_perte_poids", "tag_remise_forme", "tag_cardio", "tag_hiit"],
         "dom_coaching",
         2.3089, 48.8796,
         "Paris 8ème - Parc Monceau",
         "Parc Monceau, Paris 8",
         json.dumps([
             "https://images.pexels.com/photos/1552242/pexels-photo-1552242.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
             "https://images.pexels.com/photos/1552253/pexels-photo-1552253.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
         ])),

        ("svc_demo002", "user_demo001",
         "Séance yoga & méditation (plein air)",
         "Yoga Vinyasa en plein air. Toutes conditions bienvenues. Tapis fourni. Ressourcement garanti.",
         25.0,
         ["tag_yoga", "tag_vinyasa", "tag_meditation", "tag_outdoor"],
         "dom_sport",
         2.3841, 48.8701,
         "Paris 20ème - Parc de Belleville",
         "Parc de Belleville, Paris 20",
         json.dumps([
             "https://images.unsplash.com/photo-1758274536083-b821befda77c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"
         ])),

        ("svc_demo003", "user_demo002",
         "Préparation physique football",
         "Programme de prépa physique spécifique foot. Explosivité, endurance, prévention blessures.",
         40.0,
         ["tag_prepa_phys", "tag_football", "tag_endurance", "tag_performance"],
         "dom_coaching",
         2.3438, 48.8161,
         "Paris 13ème - Stade Charléty",
         "Stade Charléty, Paris 13",
         json.dumps([
             "https://images.unsplash.com/photo-1760331840426-027b269d0af2?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"
         ])),
    ]


def _products_data():
    # Tuple : (product_id, title, description, price, product_type, category,
    #          seller_id, tag_ids, image_url,
    #          condition_label, available_quantity, pickup_type,
    #          pricing_modes, price_per_day, city, lat, lng)
    return [
        ("mp_demo001",
         "Location vélo de route",
         "Vélo carbone taille M/L, dérailleur Shimano 105. Casque et cadenas inclus.",
         35.0, "rental", "cat_prd_bike", "user_coach001",
         ["tag_cycling", "tag_outdoor"],
         "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=400&h=400&fit=crop",
         "very_good", 1, "local_pickup", ["day"], 35.0, "Paris", 48.8530, 2.3499),

        ("mp_demo002",
         "Location tapis de yoga premium éco",
         "Tapis antidérapant en caoutchouc naturel, 183x68cm, 5mm. Parfait pour le yoga et la méditation en intérieur ou extérieur.",
         12.0, "rental", "cat_prd_yoga_mat", "user_coach001",
         ["tag_yoga", "tag_meditation"],
         "https://images.unsplash.com/photo-1592432678016-e910b452f9a2?w=400&h=400&fit=crop",
         "new", 2, "creator_handoff", ["day"], 12.0, "Paris", 48.8600, 2.3400),

        ("mp_demo003",
         "Location kit matériel HIIT complet",
         "Bandes de résistance (x5) + corde à sauter + carnet d'entraînement. Idéal pour les séances HIIT et CrossFit.",
         15.0, "rental", "cat_prd_fitness_eq", "user_demo001",
         ["tag_hiit", "tag_crossfit", "tag_cardio"],
         "https://images.unsplash.com/photo-1598632640487-6ea4a4e8b963?w=400&h=400&fit=crop",
         "good", 3, "local_pickup", ["day", "week"], 15.0, "Lyon", 45.7640, 4.8357),

        ("mp_demo004",
         "Tente camping 2 personnes",
         "Tente igloo légère 2 kg, montage 5 min. Imperméable 3000 mm.",
         25.0, "rental", "cat_prd_camping_gear", "user_demo002",
         ["tag_camping", "tag_bivouac", "tag_nature"],
         "https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?w=400&h=400&fit=crop",
         "good", 1, "creator_handoff", ["day", "week"], 25.0, "Marseille", 43.2965, 5.3698),

        ("mp_demo005",
         "Sac à dos trekking 40L",
         "Sac trekking ergonomique avec ceinture lombaire. Housse pluie incluse.",
         18.0, "rental", "cat_prd_outdoor_eq", "user_demo003",
         ["tag_trekking", "tag_hiking", "tag_montagne"],
         "https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=400&h=400&fit=crop",
         "very_good", 1, "local_pickup", ["day"], 18.0, "Bordeaux", 44.8378, -0.5792),
    ]


# ─────────────────────────────────────────────────────────────────────────────
# SEED PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────
async def seed_initial_data():
    pool = get_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:

        # ── Domaines ──────────────────────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM domains")
        if count == 0:
            for d in DOMAINS:
                await conn.execute(
                    "INSERT INTO domains (domain_id, name, label_fr, label_en, icon, color, active) "
                    "VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT DO NOTHING",
                    d["domain_id"], d["name"], d["label_fr"], d["label_en"], d["icon"], d["color"]
                )
            logger.info("Seeded domains")

        # ── Catégories ────────────────────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_categories")
        if count == 0:
            for c in CATEGORIES:
                await conn.execute(
                    "INSERT INTO tag_categories (category_id, domain_id, entity_type, name, label_fr, label_en, icon, active) "
                    "VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) ON CONFLICT DO NOTHING",
                    c["category_id"], c["domain_id"], c["entity_type"],
                    c["name"], c["label_fr"], c["label_en"], c["icon"]
                )
            logger.info("Seeded categories")

        # ── Tags ──────────────────────────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM tags")
        if count == 0:
            for t in TAGS:
                await conn.execute(
                    "INSERT INTO tags (tag_id, domain_id, name, label_fr, label_en, active) "
                    "VALUES ($1,$2,$3,$4,$5,TRUE) ON CONFLICT DO NOTHING",
                    t["tag_id"], t["domain_id"], t["name"], t["label_fr"], t["label_en"]
                )
            logger.info("Seeded tags")

        # ── Liaisons tag ↔ catégorie ──────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_category_links")
        if count == 0:
            for lnk in _build_tag_category_links():
                await conn.execute(
                    "INSERT INTO tag_category_links (tag_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                    lnk["tag_id"], lnk["category_id"]
                )
            logger.info("Seeded tag_category_links")

        # ── Liaisons tag ↔ entity_type ────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_entity_type_links")
        if count == 0:
            for lnk in _build_tag_entity_type_links():
                await conn.execute(
                    "INSERT INTO tag_entity_type_links (tag_id, entity_type) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                    lnk["tag_id"], lnk["entity_type"]
                )
            logger.info("Seeded tag_entity_type_links")

        # ── Utilisateurs ─────────────────────────────────────────────────────
        await conn.execute(
            "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags) "
            "VALUES ($1,$2,$3,$4,'admin','fr',$5,FALSE,'[]'::jsonb) ON CONFLICT DO NOTHING",
            "user_admin001", "admin@winek.app", hash_password("WinekAdmin2024!"), "Admin WINEK", "Administrateur WINEK"
        )
        await conn.execute(
            "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) "
            "VALUES ($1,$2,$3,$4,'coach','fr',$5,TRUE,$6,$7) ON CONFLICT DO NOTHING",
            "user_coach001", "coach@winek.app", hash_password("WinekCoach2024!"), "Sophie Martin",
            "Coach sportive certifiée, spécialisée fitness et running. 8 ans d'expérience.",
            json.dumps(["tag_musculation", "tag_hiit", "tag_cardio"]),
            "https://images.pexels.com/photos/1552253/pexels-photo-1552253.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
        )
        await conn.execute(
            "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) "
            "VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb,$6) ON CONFLICT DO NOTHING",
            "user_demo001", "user@winek.app", hash_password("WinekUser2024!"), "Thomas Dupont",
            "Passionné de sport et de running.",
            "https://images.pexels.com/photos/220453/pexels-photo-220453.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
        )
        await conn.execute(
            "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) "
            "VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb,$6) ON CONFLICT DO NOTHING",
            "user_demo002", "mbenali@winek.app", hash_password("WinekDemo2024!"), "Mohamed Benali",
            "Joueur de basket passionné. Fan de streetball et 3x3.",
            "https://images.pexels.com/photos/1681010/pexels-photo-1681010.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
        )
        await conn.execute(
            "INSERT INTO users (user_id, email, password_hash, name, role, language, bio, is_coach_verified, coach_tags, picture) "
            "VALUES ($1,$2,$3,$4,'user','fr',$5,FALSE,'[]'::jsonb,$6) ON CONFLICT DO NOTHING",
            "user_demo003", "cdurand@winek.app", hash_password("WinekDemo2024!"), "Camille Durand",
            "Pratiquante de yoga et arts martiaux depuis 10 ans.",
            "https://images.pexels.com/photos/1239291/pexels-photo-1239291.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=150&w=150"
        )
        logger.info("Seeded users: admin@winek.app / WinekAdmin2024!, coach@winek.app / WinekCoach2024!, user@winek.app / WinekUser2024!")

        # ── SpotYou (tag_points) ──────────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM tag_points")
        if count == 0:
            for p in _spotyou_data():
                await conn.execute(
                    "INSERT INTO tag_points (point_id, user_id, title, description, "
                    "location, precision, tag_ids, domain_id, active, image_url) "
                    "VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,TRUE,$10) "
                    "ON CONFLICT DO NOTHING",
                    p[0], p[1], p[2], p[3], p[4], p[5], p[6], json.dumps(p[7]), p[8], p[9]
                )
                await conn.execute(
                    "INSERT INTO spot_you_members (id, spot_you_id, user_id) "
                    "VALUES ($1,$2,$3) ON CONFLICT (spot_you_id, user_id) DO NOTHING",
                    f"syp_owner_{p[0]}", p[0], p[1]
                )
            logger.info("Seeded demo tag points")

        # ── Mise à jour dates/schedules SpotYou ───────────────────────────────
        await conn.execute("""
            UPDATE tag_points SET
                event_date     = DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '7 hours',
                event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '7 hours 45 minutes',
                event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"07:00","end":"07:45"}],"2":[{"start":"07:00","end":"07:45"}],"4":[{"start":"07:00","end":"07:45"}]}}'::jsonb,
                images = '["https://images.pexels.com/photos/13993895/pexels-photo-13993895.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo001'""")

        await conn.execute("""
            UPDATE tag_points SET
                event_date = NULL, event_end_date = NULL,
                event_schedule = '{"type":"weekly","schedule":{"1":[{"start":"06:45","end":"08:00"}],"3":[{"start":"06:45","end":"08:00"}]}}'::jsonb,
                images = '["https://images.unsplash.com/photo-1750089440020-58fcbd0f0d89?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo002'""")

        await conn.execute("""
            UPDATE tag_points SET
                event_date = NULL, event_end_date = NULL,
                event_schedule = '{"type":"weekly","schedule":{"0":[{"start":"07:30","end":"08:30"}],"2":[{"start":"07:30","end":"08:30"}],"4":[{"start":"07:30","end":"08:30"}]}}'::jsonb,
                images = '["https://images.unsplash.com/photo-1758274536083-b821befda77c?crop=entropy&cs=srgb&fm=jpg&ixlib=rb-4.1.0&q=85"]'::jsonb
            WHERE point_id = 'pt_demo003'""")

        await conn.execute("""
            UPDATE tag_points SET
                event_date     = DATE_TRUNC('day', NOW() + INTERVAL '5 days') + INTERVAL '9 hours',
                event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '5 days') + INTERVAL '14 hours',
                event_schedule = NULL,
                images = '["https://images.pexels.com/photos/19835454/pexels-photo-19835454.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo004'""")

        await conn.execute("""
            UPDATE tag_points SET
                event_date     = DATE_TRUNC('day', NOW() + INTERVAL '7 days') + INTERVAL '14 hours',
                event_end_date = DATE_TRUNC('day', NOW() + INTERVAL '9 days') + INTERVAL '12 hours',
                event_schedule = NULL,
                images = '["https://images.pexels.com/photos/5038834/pexels-photo-5038834.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"]'::jsonb
            WHERE point_id = 'pt_demo005'""")

        logger.info("Updated event dates and schedules")

        # ── Services ─────────────────────────────────────────────────────────
        await conn.execute("""
            UPDATE users SET role='coach', is_coach_verified=TRUE
            WHERE user_id IN ('user_demo001','user_demo002','user_demo003')
        """)

        count = await conn.fetchval("SELECT COUNT(*) FROM services")
        if count == 0:
            for s in _services_data():
                await conn.execute("""
                    INSERT INTO services
                        (service_id, coach_id, title, description, price, tag_ids, domain_id,
                         location, address, location_description, max_participants, active, images)
                    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,
                            ST_SetSRID(ST_MakePoint($8,$9),4326),$10,$11,1,TRUE,$12::jsonb)
                    ON CONFLICT (service_id) DO UPDATE SET
                        title=EXCLUDED.title, description=EXCLUDED.description,
                        price=EXCLUDED.price, tag_ids=EXCLUDED.tag_ids,
                        domain_id=EXCLUDED.domain_id, location=EXCLUDED.location,
                        address=EXCLUDED.address, location_description=EXCLUDED.location_description,
                        images=EXCLUDED.images, active=TRUE
                """, s[0], s[1], s[2], s[3], s[4],
                    json.dumps(s[5]), s[6],
                    s[7], s[8], s[9], s[10], s[11])

                await conn.execute("""
                    INSERT INTO service_locations (location_id, service_id, location, precision, description)
                    VALUES ($1,$2,ST_SetSRID(ST_MakePoint($3,$4),4326),'exact',$5) ON CONFLICT DO NOTHING
                """, f"loc_{s[0]}", s[0], s[7], s[8], s[10])

                # Packages par défaut
                await conn.execute("""
                    INSERT INTO service_packages (package_id, service_id, type_id, type_label, duration_min, max_participants, price)
                    VALUES ($1,$2,'individual','Séance individuelle',60,1,$3) ON CONFLICT DO NOTHING
                """, f"pkg_{s[0]}_ind", s[0], float(s[4]))
                await conn.execute("""
                    INSERT INTO service_packages (package_id, service_id, type_id, type_label, duration_min, max_participants, price)
                    VALUES ($1,$2,'small_group','Petit groupe (2-6)',60,6,$3) ON CONFLICT DO NOTHING
                """, f"pkg_{s[0]}_grp", s[0], round(float(s[4]) * 0.5, 2))

                # Slots sur 10 jours
                for offset in [1, 3, 5, 7, 9]:
                    await conn.execute("""
                        INSERT INTO service_slots (slot_id, service_id, package_id, slot_type, slot_date, start_time, end_time)
                        VALUES ($1,$2,$3,'specific',
                            TO_CHAR((NOW() + ($4::TEXT || ' days')::INTERVAL)::date,'YYYY-MM-DD'),
                            '09:00','10:00') ON CONFLICT DO NOTHING
                    """, f"slt_{s[0]}_ind_{offset}", s[0], f"pkg_{s[0]}_ind", str(offset))
                    await conn.execute("""
                        INSERT INTO service_slots (slot_id, service_id, package_id, slot_type, slot_date, start_time, end_time)
                        VALUES ($1,$2,$3,'specific',
                            TO_CHAR((NOW() + ($4::TEXT || ' days')::INTERVAL)::date,'YYYY-MM-DD'),
                            '11:00','12:00') ON CONFLICT DO NOTHING
                    """, f"slt_{s[0]}_grp_{offset}", s[0], f"pkg_{s[0]}_grp", str(offset))

            logger.info("Seeded 3 demo services with locations, packages and slots")

        # ── Produits marketplace ──────────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM marketplace_products")
        if count == 0:
            for p in _products_data():
                # p = (product_id, title, desc, price, product_type, category,
                #      seller_id, tag_ids, image_url,
                #      condition_label, available_quantity, pickup_type,
                #      pricing_modes, price_per_day, city, lat, lng)
                await conn.execute("""
                    INSERT INTO marketplace_products
                        (product_id, title, description, price, product_type,
                         seller_type, seller_id, tag_ids, image_url, in_stock,
                         status, category,
                         condition_label, available_quantity, pickup_type,
                         pricing_modes, price_per_day, city, lat, lng)
                    VALUES ($1,$2,$3,$4,$5,'creator',$6,$7,$8,TRUE,'active',$9,
                            $10,$11,$12,$13,$14,$15,$16,$17)
                    ON CONFLICT (product_id) DO UPDATE SET
                        title=EXCLUDED.title,
                        description=EXCLUDED.description,
                        price=EXCLUDED.price,
                        product_type=EXCLUDED.product_type,
                        seller_id=EXCLUDED.seller_id,
                        tag_ids=EXCLUDED.tag_ids,
                        image_url=EXCLUDED.image_url,
                        category=EXCLUDED.category,
                        condition_label=EXCLUDED.condition_label,
                        available_quantity=EXCLUDED.available_quantity,
                        pickup_type=EXCLUDED.pickup_type,
                        pricing_modes=EXCLUDED.pricing_modes,
                        price_per_day=EXCLUDED.price_per_day,
                        city=EXCLUDED.city,
                        lat=EXCLUDED.lat,
                        lng=EXCLUDED.lng
                """, p[0], p[1], p[2], p[3], p[4], p[6], p[7], p[8], p[5],
                     p[9], int(p[10]), p[11], p[12], p[13], p[14], p[15], p[16])

            logger.info("Seeded 5 demo marketplace products")

        # ── Plans d'abonnement ────────────────────────────────────────────────
        count = await conn.fetchval("SELECT COUNT(*) FROM subscription_plans")
        if count == 0:
            await conn.execute("""
                INSERT INTO subscription_plans
                    (plan_id, name, description, price, duration_days,
                     exempt_payer_fixed, exempt_payer_percent,
                     exempt_receiver_fixed, exempt_receiver_percent,
                     active, priority)
                VALUES
                    ('plan_basic','Basic','Accès essentiel — frais fixes payeur offerts',9.99,30,
                     TRUE,FALSE,FALSE,FALSE,TRUE,1),
                    ('plan_premium','Premium','Tout inclus — frais fixes ET variables offerts',19.99,30,
                     TRUE,TRUE,FALSE,FALSE,TRUE,2),
                    ('plan_pro_annual','Pro Annuel','Offre Pro annuelle — tous frais offerts',149.99,365,
                     TRUE,TRUE,TRUE,TRUE,TRUE,3)
                ON CONFLICT DO NOTHING
            """)
            logger.info("Seeded 3 subscription plans: plan_basic, plan_premium, plan_pro_annual")
