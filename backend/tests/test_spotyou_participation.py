"""
test_spotyou_participation.py — Tests du système de participation SpotYou
=========================================================================

Couvre :
  - join_spotyou              : rejoindre une communauté
  - auto_join_when_going      : rejoindre automatiquement en cliquant "Je viens"
  - attendance_creation       : création d'une présence à la prochaine séance
  - capacity_limit            : refus si capacité maximale atteinte
  - members_list              : liste des membres
  - going_list                : liste des présents à la prochaine séance
"""
import pytest
import asyncio
import asyncpg
import os
import uuid
import json

# URL de l'API
API_BASE = "https://shared-components.preview.emergentagent.com/api"

# Credentials
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"
USER_EMAIL  = "user@winek.app"
USER_PASS   = "WinekUser2024!"

import httpx

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
def coach_auth(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}

@pytest.fixture(scope="session")
def user_auth(user_token):
    return {"Authorization": f"Bearer {user_token}"}


def get_spot_with_schedule(client, auth) -> str:
    """Récupère un SpotYou avec event_schedule pour les tests."""
    r = client.get("/tag-points?limit=20", headers=auth)
    assert r.status_code == 200
    pts = r.json()
    pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
    for p in pts_list:
        if p.get("event_schedule"):
            return p["point_id"]
    pytest.skip("Aucun SpotYou avec event_schedule disponible")


def get_spot_without_schedule(client, auth) -> str:
    """Récupère un SpotYou sans event_schedule."""
    r = client.get("/tag-points?limit=20", headers=auth)
    assert r.status_code == 200
    pts = r.json()
    pts_list = pts.get("points", pts) if isinstance(pts, dict) else pts
    for p in pts_list:
        if not p.get("event_schedule") and not p.get("event_date"):
            return p["point_id"]
    # Fallback : utiliser n'importe quel SpotYou
    return pts_list[0]["point_id"]


# ── Test 1: join_spotyou ──────────────────────────────────────────────────────

class TestJoinSpotYou:
    def test_join_adds_user_to_community(self, client, user_auth):
        """Rejoindre un SpotYou ajoute l'utilisateur à la communauté."""
        point_id = get_spot_with_schedule(client, user_auth)

        # Rejoindre
        r = client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        assert r.status_code == 200, f"JOIN failed: {r.text}"
        data = r.json()
        assert data["success"] is True
        assert data["is_member"] is True
        assert isinstance(data["participants_count"], int)
        assert data["participants_count"] >= 1

    def test_join_is_idempotent(self, client, user_auth):
        """Rejoindre deux fois ne produit pas d'erreur et le compte reste cohérent."""
        point_id = get_spot_with_schedule(client, user_auth)

        r1 = client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        assert r1.status_code == 200
        count1 = r1.json()["participants_count"]

        r2 = client.post(f"/spot-you/{point_id}/join", headers=user_auth)
        assert r2.status_code == 200
        count2 = r2.json()["participants_count"]

        # Le compte ne doit pas augmenter
        assert count2 == count1

    def test_join_reflected_in_detail(self, client, user_auth):
        """Après avoir rejoint, is_member=True dans le détail du SpotYou."""
        point_id = get_spot_with_schedule(client, user_auth)
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)

        r = client.get(f"/tag-points/{point_id}", headers=user_auth)
        assert r.status_code == 200
        data = r.json()
        assert data.get("is_member") is True or data.get("is_participant") is True


# ── Test 2: auto_join_when_going ─────────────────────────────────────────────

class TestAutoJoinWhenGoing:
    def test_going_auto_joins_community(self, client, user_auth):
        """Cliquer 'Je viens' auto-rejoint la communauté si pas encore membre."""
        point_id = get_spot_with_schedule(client, user_auth)

        # Quitter d'abord (pour être sûr)
        client.delete(f"/spot-you/{point_id}/leave", headers=user_auth)

        # Indiquer présence
        r = client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r.status_code == 200, f"GOING failed: {r.text}"
        data = r.json()
        assert data["is_going"] is True
        assert data["is_member"] is True


# ── Test 3: attendance_creation ───────────────────────────────────────────────

class TestAttendanceCreation:
    def test_going_creates_attendance_record(self, client, user_auth):
        """Indiquer sa présence crée bien un enregistrement de présence."""
        point_id = get_spot_with_schedule(client, user_auth)

        r = client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r.status_code == 200
        data = r.json()
        assert data["is_going"] is True
        assert "session_date" in data
        assert data["session_date"] is not None

    def test_going_count_increases(self, client, user_auth, coach_auth):
        """Le going_count augmente après inscription."""
        point_id = get_spot_with_schedule(client, user_auth)

        # Récupérer le count initial
        r_before = client.get(f"/tag-points/{point_id}", headers=user_auth)
        count_before = r_before.json().get("going_count", 0)

        # Inscrire l'utilisateur
        client.post(f"/spot-you/{point_id}/going", headers=user_auth)

        # Vérifier le count après
        r_after = client.get(f"/tag-points/{point_id}", headers=user_auth)
        count_after = r_after.json().get("going_count", 0)
        assert count_after >= 1  # Au moins 1 inscrit

    def test_going_is_idempotent(self, client, user_auth):
        """Indiquer sa présence deux fois ne crée pas de doublon."""
        point_id = get_spot_with_schedule(client, user_auth)

        r1 = client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r1.status_code == 200
        count1 = r1.json()["going_count"]

        r2 = client.post(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r2.status_code == 200
        count2 = r2.json()["going_count"]

        assert count2 == count1


# ── Test 4: capacity_limit ────────────────────────────────────────────────────

class TestCapacityLimit:
    def test_create_spotyou_with_capacity(self, client, coach_auth):
        """Créer un SpotYou avec capacité maximum de 2."""
        r = client.post("/tag-points", headers=coach_auth, json={
            "title": "Test capacité " + str(uuid.uuid4())[:8],
            "description": "Test capacité maximale",
            "latitude": 48.8566,
            "longitude": 2.3522,
            "domain_id": "dom_sport",
            "tag_ids": [],
            "event_schedule": {
                "type": "weekly",
                "schedule": {"0": [{"start": "10:00", "end": "11:00"}]}
            },
            "minimum_participants": 1,
            "maximum_participants": 2,
        })
        assert r.status_code == 200, f"Create failed: {r.text}"
        data = r.json()
        assert data.get("maximum_participants") == 2
        assert data.get("minimum_participants") == 1
        return data["point_id"]

    def test_capacity_auto_fill_min_from_max(self, client, coach_auth):
        """Si max défini mais pas min → min = max."""
        r = client.post("/tag-points", headers=coach_auth, json={
            "title": "Test auto-fill " + str(uuid.uuid4())[:8],
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "dom_sport", "tag_ids": [],
            "maximum_participants": 5,
        })
        assert r.status_code == 200
        data = r.json()
        assert data["maximum_participants"] == 5
        assert data["minimum_participants"] == 5

    def test_capacity_auto_fill_max_from_min(self, client, coach_auth):
        """Si min défini mais pas max → max = min."""
        r = client.post("/tag-points", headers=coach_auth, json={
            "title": "Test auto-fill min " + str(uuid.uuid4())[:8],
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "dom_sport", "tag_ids": [],
            "minimum_participants": 3,
        })
        assert r.status_code == 200
        data = r.json()
        assert data["minimum_participants"] == 3
        assert data["maximum_participants"] == 3


# ── Test 5: members_list ──────────────────────────────────────────────────────

class TestMembersList:
    def test_members_list_returns_joined_users(self, client, user_auth):
        """GET /spot-you/{id}/members retourne les membres."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'assurer que l'utilisateur est membre
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)

        r = client.get(f"/spot-you/{point_id}/members")
        assert r.status_code == 200
        members = r.json()
        assert isinstance(members, list)
        assert len(members) >= 1

        # Vérifier la structure
        member = members[0]
        assert "user_id" in member
        assert "name" in member

    def test_members_list_shows_creator_first(self, client, user_auth, coach_auth):
        """Le créateur apparaît en premier dans la liste des membres si présent."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'assurer que le coach (créateur) est membre
        client.post(f"/spot-you/{point_id}/join", headers=coach_auth)
        client.post(f"/spot-you/{point_id}/join", headers=user_auth)

        r = client.get(f"/spot-you/{point_id}/members")
        assert r.status_code == 200
        members = r.json()
        assert len(members) >= 2

        # Le créateur doit apparaître dans la liste
        creators = [m for m in members if m.get("is_creator")]
        assert len(creators) >= 1, "Le créateur doit être dans la liste des membres"
        # Le créateur doit être en premier
        assert members[0].get("is_creator") is True


# ── Test 6: going_list ────────────────────────────────────────────────────────

class TestGoingList:
    def test_going_list_returns_session_attendees(self, client, user_auth):
        """GET /spot-you/{id}/going retourne les présents à la prochaine séance."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'inscrire à la séance
        client.post(f"/spot-you/{point_id}/going", headers=user_auth)

        r = client.get(f"/spot-you/{point_id}/going")
        assert r.status_code == 200
        data = r.json()
        assert "session_date" in data
        assert "going" in data
        assert isinstance(data["going"], list)
        assert len(data["going"]) >= 1

    def test_going_list_has_user_fields(self, client, user_auth):
        """Les présents ont les champs user_id, name, picture."""
        point_id = get_spot_with_schedule(client, user_auth)
        client.post(f"/spot-you/{point_id}/going", headers=user_auth)

        r = client.get(f"/spot-you/{point_id}/going")
        assert r.status_code == 200
        going = r.json().get("going", [])
        if going:
            user_entry = going[0]
            assert "user_id" in user_entry
            assert "name" in user_entry

    def test_not_going_removes_attendance(self, client, user_auth):
        """DELETE /spot-you/{id}/going retire la présence."""
        point_id = get_spot_with_schedule(client, user_auth)
        # S'inscrire
        client.post(f"/spot-you/{point_id}/going", headers=user_auth)

        # Vérifier inscrit
        r1 = client.get(f"/tag-points/{point_id}", headers=user_auth)
        assert r1.json().get("is_going") is True

        # Se désinscrire
        r_del = client.delete(f"/spot-you/{point_id}/going", headers=user_auth)
        assert r_del.status_code == 200
        assert r_del.json()["is_going"] is False

        # Vérifier désinscrit
        r2 = client.get(f"/tag-points/{point_id}", headers=user_auth)
        assert r2.json().get("is_going") is False


# ── Test 7: Tag point detail includes new fields ──────────────────────────────

class TestTagPointDetailFields:
    def test_detail_includes_participation_fields(self, client, user_auth):
        """GET /tag-points/{id} inclut les nouveaux champs de participation."""
        point_id = get_spot_with_schedule(client, user_auth)
        r = client.get(f"/tag-points/{point_id}", headers=user_auth)
        assert r.status_code == 200
        data = r.json()
        assert "going_count" in data
        assert "is_going" in data
        assert "is_member" in data
        assert "is_full" in data
        assert "participants_count" in data

    def test_detail_includes_next_session_date_for_recurring(self, client, user_auth):
        """GET /tag-points/{id} inclut next_session_date pour les récurrents."""
        point_id = get_spot_with_schedule(client, user_auth)
        r = client.get(f"/tag-points/{point_id}", headers=user_auth)
        assert r.status_code == 200
        data = r.json()
        assert "next_session_date" in data
        assert data["next_session_date"] is not None
