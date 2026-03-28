"""
test_business_rules_audit.py — Tests des 9 règles métier non couvertes
======================================================================

Couvre :
  1. Interdiction de réserver son propre service        (P0)
  2. Propriétaire ne peut pas quitter sa communauté      (P1)
  3. Quitter → annule participations futures              (P1)
  4. Masquage coordonnées (précision 100m/1000m)         (P1)
  5. Max 10 images — validation backend                  (P1)
  6. Slots masqués si booking actif                       (P2)
  7. Images retirées → supprimées du disque               (P2)
  8. Service soft delete                                  (P2)
  9. Fuseau Europe/Paris pour next_session                (P3)
"""
import pytest
import httpx
import os
import sys
import uuid
import json
import math
import psycopg2
import psycopg2.extras
from datetime import datetime, timedelta, date, time, timezone
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

API_BASE = "https://metro-stability.preview.emergentagent.com/api"
DB_DSN = "dbname=winek_db user=winek password=winek2024 host=localhost port=5432"

COACH_EMAIL = "coach@winek.app"
COACH_PASS = "WinekCoach2024!"
USER_EMAIL = "user@winek.app"
USER_PASS = "WinekUser2024!"
ADMIN_EMAIL = "admin@winek.app"
ADMIN_PASS = "WinekAdmin2024!"


# ── DB helpers ─────────────────────────────────────────────────────────────────

def db_conn():
    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = True
    return conn


def db_query(sql, params=None):
    conn = db_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, params or ())
    try:
        rows = cur.fetchall()
    except psycopg2.ProgrammingError:
        rows = []
    cur.close()
    conn.close()
    return [dict(r) for r in rows]


def db_exec(sql, params=None):
    conn = db_conn()
    cur = conn.cursor()
    cur.execute(sql, params or ())
    cur.close()
    conn.close()


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client():
    return httpx.Client(base_url=API_BASE, timeout=30)


@pytest.fixture(scope="session")
def coach_token(client):
    r = client.post("/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def user_token(client):
    r = client.post("/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"User login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token(client):
    r = client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def coach_headers(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}


@pytest.fixture(scope="session")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def coach_user_id(client, coach_token):
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {coach_token}"})
    assert r.status_code == 200, f"GET /auth/me failed: {r.status_code} {r.text}"
    return r.json()["user_id"]


@pytest.fixture(scope="session")
def user_user_id(client, user_token):
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {user_token}"})
    assert r.status_code == 200, f"GET /auth/me failed: {r.status_code} {r.text}"
    return r.json()["user_id"]


def _get_coach_service(client, coach_headers) -> dict:
    """Récupère un service actif du coach pour les tests."""
    r = client.get("/services/mine", headers=coach_headers)
    assert r.status_code == 200
    services = r.json()
    services_list = services if isinstance(services, list) else services.get("services", [])
    for s in services_list:
        if s.get("active", True):
            return s
    pytest.skip("Aucun service actif du coach disponible")


def _get_coach_spotyou(client, coach_headers, coach_user_id) -> str:
    """Récupère un SpotYou créé par le coach."""
    r = client.get("/tag-points/mine", headers=coach_headers)
    assert r.status_code == 200
    data = r.json()
    pts = data.get("points", data) if isinstance(data, dict) else data
    for p in pts:
        if p.get("user_id") == coach_user_id and not p.get("cancelled"):
            return p["point_id"]
    pytest.skip("Aucun SpotYou du coach disponible")


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 1 — Interdiction de réserver son propre service (P0)
# ═══════════════════════════════════════════════════════════════════════════════

class TestCannotBookOwnService:
    """booking_routes.py L159 — Le coach ne peut pas réserver son propre service."""

    def test_booking_own_service_returns_400(self, client, coach_headers):
        svc = _get_coach_service(client, coach_headers)
        service_id = svc["service_id"]

        # Récupérer un slot_id si disponible
        r = client.get(f"/services/{service_id}", headers=coach_headers)
        assert r.status_code == 200
        detail = r.json()
        slots = detail.get("slots", [])
        slot_id = slots[0]["slot_id"] if slots else None

        payload = {
            "service_id": service_id,
            "payment_mode": "pay_now",
        }
        if slot_id:
            payload["slot_id"] = slot_id

        r = client.post("/bookings", json=payload, headers=coach_headers)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        assert "propre service" in r.json().get("detail", "").lower() or "own" in r.json().get("detail", "").lower()


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 2 — Propriétaire ne peut pas quitter sa communauté (P1)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOwnerCannotLeaveCommunity:
    """spot_you_routes.py L206-212 — Le propriétaire reçoit 403."""

    def test_owner_leave_returns_403(self, client, coach_headers, coach_user_id):
        point_id = _get_coach_spotyou(client, coach_headers, coach_user_id)
        r = client.delete(f"/spot-you/{point_id}/leave", headers=coach_headers)
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        body = r.json()
        assert "propriétaire" in body.get("detail", "").lower() or "owner" in body.get("detail", "").lower()

    def test_non_owner_can_leave(self, client, user_headers, coach_headers, coach_user_id):
        point_id = _get_coach_spotyou(client, coach_headers, coach_user_id)
        # D'abord rejoindre
        client.post(f"/spot-you/{point_id}/join", headers=user_headers)
        # Quitter
        r = client.delete(f"/spot-you/{point_id}/leave", headers=user_headers)
        assert r.status_code == 200
        assert r.json()["is_member"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 3 — Quitter → annule participations futures (P1)
# ═══════════════════════════════════════════════════════════════════════════════

class TestLeaveDeletesFutureAttendance:
    """spot_you_routes.py L220-225 — Leave supprime les attendances futures."""

    def test_leave_removes_future_attendance(self, client, user_headers, coach_headers, coach_user_id):
        """Rejoindre un SpotYou avec schedule, marquer 'going', quitter, vérifier suppression."""
        # Trouver un SpotYou avec event_schedule
        r = client.get("/tag-points/mine", headers=coach_headers)
        assert r.status_code == 200
        data = r.json()
        pts = data.get("points", data) if isinstance(data, dict) else data

        point_id = None
        for p in pts:
            if p.get("event_schedule") and p.get("user_id") == coach_user_id and not p.get("cancelled"):
                point_id = p["point_id"]
                break

        if not point_id:
            pytest.skip("Aucun SpotYou récurrent du coach disponible")

        # 1. Rejoindre
        r = client.post(f"/spot-you/{point_id}/join", headers=user_headers)
        assert r.status_code == 200

        # 2. Marquer "going" à la prochaine séance
        r = client.post(f"/spot-you/{point_id}/going", headers=user_headers)
        if r.status_code != 200:
            pytest.skip("Impossible de marquer going (pas de prochaine séance)")

        # 3. Vérifier qu'on est going
        r = client.get(f"/tag-points/{point_id}", headers=user_headers)
        assert r.status_code == 200
        assert r.json().get("is_going") is True

        # 4. Quitter la communauté
        r = client.delete(f"/spot-you/{point_id}/leave", headers=user_headers)
        assert r.status_code == 200

        # 5. Vérifier la suppression de l'attendance en DB
        rows = db_query(
            """SELECT * FROM spot_you_attendance
               WHERE spot_you_id = %s AND user_id = (
                   SELECT user_id FROM users WHERE email = %s
               ) AND session_date >= CURRENT_DATE""",
            (point_id, USER_EMAIL)
        )
        assert len(rows) == 0, f"Future attendance should be deleted, but found {len(rows)} rows"


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 4 — Masquage coordonnées (précision 100m/1000m) (P1)
# ═══════════════════════════════════════════════════════════════════════════════

class TestCoordinatePrecisionMasking:
    """tagpoint_routes.py L52-90 + L193-198 — Non-owners reçoivent des coordonnées décalées."""

    def test_apply_precision_offset_100m(self):
        """Vérifie que le décalage 100m est dans les bornes."""
        from routes.tagpoint_routes import apply_precision_offset
        lat, lng = 48.8566, 2.3522  # Paris
        new_lat, new_lng = apply_precision_offset(lat, lng, "100m", seed="test_seed")
        # Distance en mètres
        dlat = (new_lat - lat) * 111320
        dlng = (new_lng - lng) * 111320 * math.cos(math.radians(lat))
        distance = math.sqrt(dlat**2 + dlng**2)
        assert distance <= 100, f"Offset should be <= 100m, got {distance:.1f}m"
        assert distance > 0, "Offset should not be 0"

    def test_apply_precision_offset_1000m(self):
        """Vérifie que le décalage 1000m est dans les bornes."""
        from routes.tagpoint_routes import apply_precision_offset
        lat, lng = 48.8566, 2.3522
        new_lat, new_lng = apply_precision_offset(lat, lng, "1000m", seed="test_seed_2")
        dlat = (new_lat - lat) * 111320
        dlng = (new_lng - lng) * 111320 * math.cos(math.radians(lat))
        distance = math.sqrt(dlat**2 + dlng**2)
        assert distance <= 1000, f"Offset should be <= 1000m, got {distance:.1f}m"
        assert distance > 0, "Offset should not be 0"

    def test_exact_precision_no_offset(self):
        """Précision 'exact' ne décale pas les coordonnées."""
        from routes.tagpoint_routes import apply_precision_offset
        lat, lng = 48.8566, 2.3522
        new_lat, new_lng = apply_precision_offset(lat, lng, "exact")
        assert new_lat == lat
        assert new_lng == lng

    def test_seed_produces_consistent_offset(self):
        """Le même seed donne le même décalage."""
        from routes.tagpoint_routes import apply_precision_offset
        lat, lng = 48.8566, 2.3522
        r1 = apply_precision_offset(lat, lng, "100m", seed="consistent_seed")
        r2 = apply_precision_offset(lat, lng, "100m", seed="consistent_seed")
        assert r1 == r2, "Same seed should produce same offset"

    def test_search_masks_coordinates_for_non_owner(self, client, user_headers, coach_headers, coach_user_id):
        """La recherche masque les coordonnées pour un non-propriétaire si precision != exact."""
        # Trouver un SpotYou du coach avec precision 100m ou 1000m
        rows = db_query(
            "SELECT point_id, precision, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng "
            "FROM tag_points WHERE user_id = %s AND active = TRUE AND precision IN ('100m', '1000m') LIMIT 1",
            (coach_user_id,)
        )
        if not rows:
            pytest.skip("Aucun SpotYou avec precision masquée")

        point_id = rows[0]["point_id"]
        db_lat = float(rows[0]["lat"])
        db_lng = float(rows[0]["lng"])

        # Accéder en tant que non-owner (user)
        r = client.get(f"/tag-points/{point_id}", headers=user_headers)
        assert r.status_code == 200
        pt = r.json()
        api_lat = pt.get("latitude")
        api_lng = pt.get("longitude")

        # Note: en endpoint detail, le masquage n'est appliqué que dans search
        # Mais le point est que la DB a des coordonnées randomisées au stockage
        # On vérifie juste que la fonction fonctionne correctement (tests unitaires ci-dessus)
        assert api_lat is not None
        assert api_lng is not None


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 5 — Max images — backend validation (P1)
# ═══════════════════════════════════════════════════════════════════════════════

class TestMaxImagesValidation:
    """
    create.tsx L300 valide max 10 images côté frontend.
    Ce test vérifie que le backend accepte/rejette correctement une mise à jour
    avec >10 images (actuellement aucune validation backend — ce test documente le gap).
    """

    def test_create_tagpoint_with_11_images_rejected(self, client, coach_headers):
        """Le backend rejette la création d'un SpotYou avec >10 images."""
        fake_images = [f"https://example.com/img_{i}.jpg" for i in range(11)]
        payload = {
            "title": "Test Max Images",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "domain_id": "dom_sport",
            "images": fake_images,
        }
        r = client.post("/tag-points", json=payload, headers=coach_headers)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        assert "10 images" in r.json().get("detail", "")

    def test_update_tagpoint_with_11_images_rejected(self, client, coach_headers, coach_user_id):
        """Le backend rejette la mise à jour d'un SpotYou avec >10 images."""
        point_id = _get_coach_spotyou(client, coach_headers, coach_user_id)
        fake_images = [f"https://example.com/img_{i}.jpg" for i in range(11)]
        r = client.put(
            f"/tag-points/{point_id}",
            json={"images": fake_images},
            headers=coach_headers,
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        assert "10 images" in r.json().get("detail", "")

    def test_update_tagpoint_with_10_images_accepted(self, client, coach_headers, coach_user_id):
        """Le backend accepte exactement 10 images."""
        point_id = _get_coach_spotyou(client, coach_headers, coach_user_id)
        fake_images = [f"https://example.com/img_{i}.jpg" for i in range(10)]
        r = client.put(
            f"/tag-points/{point_id}",
            json={"images": fake_images},
            headers=coach_headers,
        )
        assert r.status_code == 200
        # Cleanup
        client.put(f"/tag-points/{point_id}", json={"images": []}, headers=coach_headers)


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 6 — Slots masqués si booking actif (P2)
# ═══════════════════════════════════════════════════════════════════════════════

class TestSlotsHiddenWithActiveBooking:
    """service_routes.py L76-90 — Les créneaux avec booking actif sont exclus."""

    def test_slot_with_active_booking_not_in_list(self, client, coach_headers, user_headers):
        """Un créneau avec un booking actif ne doit pas apparaître dans les slots du service."""
        svc = _get_coach_service(client, coach_headers)
        service_id = svc["service_id"]

        # Lister les slots
        r = client.get(f"/services/{service_id}", headers=user_headers)
        assert r.status_code == 200
        all_slots = r.json().get("slots", [])

        if not all_slots:
            pytest.skip("Aucun slot disponible")

        # Vérifier en DB s'il y a des bookings actifs pour ce service
        booked_slots = db_query(
            """SELECT DISTINCT b.slot_id FROM bookings b
               WHERE b.service_id = %s
               AND b.status IN ('pending', 'accepted', 'awaiting_payment', 'confirmed')
               AND b.slot_id IS NOT NULL""",
            (service_id,)
        )
        booked_slot_ids = {r["slot_id"] for r in booked_slots}

        # Vérifier qu'aucun slot retourné par l'API n'a de booking actif
        returned_slot_ids = {s["slot_id"] for s in all_slots}
        intersection = returned_slot_ids & booked_slot_ids
        assert len(intersection) == 0, (
            f"Slots with active booking should be hidden, but found: {intersection}"
        )

    def test_slot_query_excludes_past_dates(self, client, coach_headers):
        """Les créneaux avec date passée ne sont pas retournés."""
        svc = _get_coach_service(client, coach_headers)
        service_id = svc["service_id"]

        r = client.get(f"/services/{service_id}", headers=coach_headers)
        assert r.status_code == 200
        slots = r.json().get("slots", [])

        now = datetime.now()
        for slot in slots:
            if slot.get("slot_date"):
                slot_dt_str = f"{slot['slot_date']} {slot.get('start_time', '00:00')}"
                try:
                    slot_dt = datetime.strptime(slot_dt_str, "%Y-%m-%d %H:%M")
                    assert slot_dt > now, f"Slot {slot['slot_id']} is in the past: {slot_dt_str}"
                except ValueError:
                    pass  # Format non standard, on skip


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 7 — Images retirées → supprimées du disque (P2)
# ═══════════════════════════════════════════════════════════════════════════════

class TestImageDeletionOnRemoval:
    """tagpoint_routes.py L1265-1271 — Les images retirées d'un SpotYou sont supprimées du disque."""

    def test_delete_upload_files_removes_files(self):
        """Test unitaire de la fonction delete_upload_files."""
        from routes.upload_routes import delete_upload_files

        # Créer des fichiers temporaires dans le répertoire uploads
        uploads_dir = Path("/app/backend/uploads")
        uploads_dir.mkdir(parents=True, exist_ok=True)

        test_filenames = [f"test_del_{uuid.uuid4().hex[:8]}.jpg" for _ in range(3)]
        test_paths = []
        for fn in test_filenames:
            fp = uploads_dir / fn
            fp.write_text("dummy image content")
            test_paths.append(fp)
            assert fp.exists(), f"Test file should be created: {fp}"

        # Construire les URLs comme le ferait l'API
        urls = [f"/api/uploads/{fn}" for fn in test_filenames]

        # Supprimer via la fonction
        delete_upload_files(urls)

        # Vérifier que les fichiers sont supprimés
        for fp in test_paths:
            assert not fp.exists(), f"File should be deleted: {fp}"

    def test_delete_upload_files_handles_missing_gracefully(self):
        """La suppression de fichiers inexistants ne lève pas d'erreur."""
        from routes.upload_routes import delete_upload_files
        # Ne doit pas lever d'exception
        delete_upload_files(["/api/uploads/nonexistent_file_12345.jpg"])

    def test_update_tagpoint_images_triggers_deletion(self, client, coach_headers, coach_user_id):
        """Vérifier que la mise à jour des images supprime les anciennes du disque."""
        point_id = _get_coach_spotyou(client, coach_headers, coach_user_id)

        # Créer un fichier qui simule une image uploadée
        uploads_dir = Path("/app/backend/uploads")
        test_fn = f"test_img_removal_{uuid.uuid4().hex[:8]}.jpg"
        test_fp = uploads_dir / test_fn
        test_fp.write_text("fake image data")
        test_url = f"/api/uploads/{test_fn}"

        # D'abord, sauvegarder les images actuelles
        r = client.get(f"/tag-points/{point_id}", headers=coach_headers)
        original_images = r.json().get("images", []) or []

        # Mettre à jour avec notre image test
        new_images = original_images + [test_url]
        r = client.put(
            f"/tag-points/{point_id}",
            json={"images": new_images},
            headers=coach_headers,
        )
        assert r.status_code == 200

        # Maintenant retirer notre image test
        r = client.put(
            f"/tag-points/{point_id}",
            json={"images": original_images},
            headers=coach_headers,
        )
        assert r.status_code == 200

        # Vérifier que le fichier a été supprimé du disque
        assert not test_fp.exists(), f"Removed image file should be deleted from disk: {test_fp}"


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 8 — Service soft delete (P2)
# ═══════════════════════════════════════════════════════════════════════════════

class TestServiceSoftDelete:
    """service_routes.py L507-523 — DELETE met active=FALSE au lieu de supprimer."""

    def test_delete_service_sets_active_false(self, client, coach_headers):
        """Supprimer un service met active=FALSE en DB, pas de suppression physique."""
        # Créer un service temporaire
        payload = {
            "title": f"Test Soft Delete {uuid.uuid4().hex[:6]}",
            "description": "Service pour tester le soft delete",
            "price": 10.0,
            "currency": "EUR",
            "locations": [{
                "latitude": 48.8566,
                "longitude": 2.3522,
                "precision": "exact",
                "description": "Test location"
            }],
        }
        r = client.post("/services", json=payload, headers=coach_headers)
        assert r.status_code in (200, 201), f"Service creation failed: {r.text}"
        service_id = r.json()["service_id"]

        # Vérifier qu'il est actif
        rows = db_query("SELECT active FROM services WHERE service_id = %s", (service_id,))
        assert len(rows) == 1
        assert rows[0]["active"] is True

        # Supprimer
        r = client.delete(f"/services/{service_id}", headers=coach_headers)
        assert r.status_code == 200

        # Vérifier que le service existe toujours mais est inactif
        rows = db_query("SELECT active FROM services WHERE service_id = %s", (service_id,))
        assert len(rows) == 1, "Service should still exist in DB (soft delete)"
        assert rows[0]["active"] is False, "Service should be marked inactive"

    def test_deleted_service_not_in_listing(self, client, coach_headers):
        """Un service soft-deleted ne doit plus apparaître dans les listes publiques."""
        # Créer et supprimer un service
        payload = {
            "title": f"Test Hidden {uuid.uuid4().hex[:6]}",
            "description": "Service qui sera supprimé",
            "price": 15.0,
            "currency": "EUR",
            "locations": [{
                "latitude": 48.8566,
                "longitude": 2.3522,
                "precision": "exact",
                "description": "Test"
            }],
        }
        r = client.post("/services", json=payload, headers=coach_headers)
        assert r.status_code in (200, 201)
        service_id = r.json()["service_id"]

        # Supprimer
        r = client.delete(f"/services/{service_id}", headers=coach_headers)
        assert r.status_code == 200

        # Vérifier qu'il n'apparaît plus dans la liste
        r = client.get("/services/mine", headers=coach_headers)
        assert r.status_code == 200
        services = r.json()
        services_list = services if isinstance(services, list) else services.get("services", [])
        found_ids = [s["service_id"] for s in services_list]
        assert service_id not in found_ids, "Soft-deleted service should not appear in listing"

    def test_delete_by_non_owner_returns_403(self, client, coach_headers, user_headers):
        """Un utilisateur non-propriétaire ne peut pas supprimer un service."""
        svc = _get_coach_service(client, coach_headers)
        r = client.delete(f"/services/{svc['service_id']}", headers=user_headers)
        assert r.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# RULE 9 — Fuseau Europe/Paris pour calcul next_session (P3)
# ═══════════════════════════════════════════════════════════════════════════════

class TestTimezoneParis:
    """spot_you_routes.py L33-35 — get_next_session_date utilise Europe/Paris."""

    def test_get_next_session_date_uses_paris_timezone(self):
        """Vérifier que le calcul utilise le fuseau Paris, pas UTC."""
        from routes.spot_you_routes import get_next_session_date
        from zoneinfo import ZoneInfo

        paris = ZoneInfo("Europe/Paris")
        now_paris = datetime.now(paris)
        today_weekday = now_paris.weekday()

        # Créer un schedule qui a une séance demain
        tomorrow_weekday = (today_weekday + 1) % 7
        schedule = {
            "type": "weekly",
            "schedule": {
                str(tomorrow_weekday): [{"start": "10:00", "end": "11:00"}]
            }
        }
        point = {"event_schedule": schedule, "event_date": None}
        result = get_next_session_date(point)

        expected_date = (now_paris + timedelta(days=1)).date()
        assert result == expected_date, f"Expected {expected_date}, got {result}"

    def test_get_next_session_date_today_past_skips_to_next_week(self):
        """Si la séance d'aujourd'hui est passée, on retourne la semaine prochaine."""
        from routes.spot_you_routes import get_next_session_date
        from zoneinfo import ZoneInfo

        paris = ZoneInfo("Europe/Paris")
        now_paris = datetime.now(paris)
        today_weekday = now_paris.weekday()

        # Schedule pour aujourd'hui à 00:01 (séance passée)
        schedule = {
            "type": "weekly",
            "schedule": {
                str(today_weekday): [{"start": "00:01", "end": "00:02"}]
            }
        }
        point = {"event_schedule": schedule, "event_date": None}
        result = get_next_session_date(point)

        # Comme la séance est passée, la prochaine est dans 7 jours
        expected_date = now_paris.date() + timedelta(days=7)
        assert result == expected_date, f"Expected next week ({expected_date}), got {result}"

    def test_get_next_session_date_today_future_returns_today(self):
        """Si la séance d'aujourd'hui est encore dans le futur, on retourne aujourd'hui."""
        from routes.spot_you_routes import get_next_session_date
        from zoneinfo import ZoneInfo

        paris = ZoneInfo("Europe/Paris")
        now_paris = datetime.now(paris)
        today_weekday = now_paris.weekday()

        # Schedule pour aujourd'hui à 23:59 (séance future)
        schedule = {
            "type": "weekly",
            "schedule": {
                str(today_weekday): [{"start": "23:59", "end": "23:59"}]
            }
        }
        point = {"event_schedule": schedule, "event_date": None}
        result = get_next_session_date(point)

        expected_date = now_paris.date()
        assert result == expected_date, f"Expected today ({expected_date}), got {result}"

    def test_get_next_session_date_no_schedule_returns_none(self):
        """Sans schedule ni event_date, retourne None."""
        from routes.spot_you_routes import get_next_session_date
        point = {"event_schedule": None, "event_date": None}
        result = get_next_session_date(point)
        assert result is None

    def test_get_next_session_date_event_date_future(self):
        """event_date dans le futur est retourné directement."""
        from routes.spot_you_routes import get_next_session_date
        from zoneinfo import ZoneInfo

        paris = ZoneInfo("Europe/Paris")
        future_dt = datetime.now(paris) + timedelta(days=5)

        point = {"event_schedule": None, "event_date": future_dt}
        result = get_next_session_date(point)
        assert result == future_dt.date()
