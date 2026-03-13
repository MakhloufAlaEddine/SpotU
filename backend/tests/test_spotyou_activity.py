"""
test_spotyou_activity.py — Tests du fil d'activité SpotYou
==========================================================

Couvre :
  - GET /spot-you/{id}/activity retourne les bons champs
  - Les 'vient [jour]' ne sont affichés que pour les sessions futures (session_date >= today)
  - Les 'a rejoint' ne sont affichés que pour les 30 derniers jours
  - La structure de chaque activité est correcte (type, user_id, name, picture, action_text, timestamp)
  - Résultat trié par timestamp DESC
"""
import pytest
import httpx
from datetime import datetime, timezone

# URL de l'API
API_BASE = "https://profile-smoke-test.preview.emergentagent.com/api"

# Credentials
USER_EMAIL = "user@winek.app"
USER_PASS  = "WinekUser2024!"
COACH_EMAIL = "coach@winek.app"
COACH_PASS  = "WinekCoach2024!"

POINT_ID = "pt_demo004"  # CrossFit outdoor - has event_schedule (weekly, Sunday)


@pytest.fixture(scope="session")
def client():
    return httpx.Client(base_url=API_BASE, timeout=30)


@pytest.fixture(scope="session")
def user_token(client):
    r = client.post("/auth/login", json={"email": USER_EMAIL, "password": USER_PASS})
    assert r.status_code == 200, f"User login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def user_auth(user_token):
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture(scope="session")
def coach_token(client):
    r = client.post("/auth/login", json={"email": COACH_EMAIL, "password": COACH_PASS})
    assert r.status_code == 200, f"Coach login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def coach_auth(coach_token):
    return {"Authorization": f"Bearer {coach_token}"}


# ── Test 1: Structure et champs de la réponse ─────────────────────────────────

class TestActivityFeedStructure:
    def test_activity_endpoint_returns_200(self, client, user_auth):
        """GET /spot-you/{id}/activity retourne un statut 200."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200, f"Activity endpoint failed: {r.text}"

    def test_activity_response_has_activities_key(self, client, user_auth):
        """La réponse contient une clé 'activities' (liste)."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        data = r.json()
        assert "activities" in data, "Response must have 'activities' key"
        assert isinstance(data["activities"], list)

    def test_activity_items_have_required_fields(self, client, user_auth):
        """Chaque activité contient type, user_id, name, picture, action_text, timestamp."""
        # Ensure user is a member and has going status
        client.post(f"/spot-you/{POINT_ID}/join", headers=user_auth)
        client.post(f"/spot-you/{POINT_ID}/going", headers=user_auth)

        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]
        assert len(activities) > 0, "Activity feed should not be empty for a member"

        for activity in activities:
            assert "type" in activity, f"Missing 'type' in activity: {activity}"
            assert "user_id" in activity, f"Missing 'user_id' in activity: {activity}"
            assert "name" in activity, f"Missing 'name' in activity: {activity}"
            assert "picture" in activity, f"Missing 'picture' in activity: {activity}"
            assert "action_text" in activity, f"Missing 'action_text' in activity: {activity}"
            assert "timestamp" in activity, f"Missing 'timestamp' in activity: {activity}"

    def test_activity_types_are_valid(self, client, user_auth):
        """Le type de chaque activité est soit 'going' soit 'joined'."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]
        for activity in activities:
            assert activity["type"] in ["going", "joined"], \
                f"Invalid type '{activity['type']}', must be 'going' or 'joined'"

    def test_activity_timestamps_are_iso(self, client, user_auth):
        """Les timestamps sont des chaînes ISO 8601 valides."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]
        for activity in activities:
            ts = activity["timestamp"]
            try:
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                pytest.fail(f"Invalid ISO timestamp: {ts}")

    def test_activity_sorted_by_timestamp_desc(self, client, user_auth):
        """Les activités sont triées par timestamp DESC (plus récent en premier)."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]
        if len(activities) >= 2:
            for i in range(len(activities) - 1):
                ts_current = datetime.fromisoformat(activities[i]["timestamp"].replace("Z", "+00:00"))
                ts_next = datetime.fromisoformat(activities[i+1]["timestamp"].replace("Z", "+00:00"))
                assert ts_current >= ts_next, \
                    f"Activities not sorted DESC: {activities[i]['timestamp']} < {activities[i+1]['timestamp']}"


# ── Test 2: Règle - 'vient [jour]' seulement pour sessions futures ────────────

class TestGoingFilterFutureSessions:
    def test_going_activities_have_future_session_dates(self, client, user_auth):
        """Les activités 'going' ne montrent QUE les sessions futures (session_date >= today)."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        today = datetime.now(timezone.utc).date()
        for activity in activities:
            if activity["type"] == "going":
                session_date_str = activity.get("session_date")
                assert session_date_str is not None, \
                    "Going activity must have a session_date"
                from datetime import date
                session_date = date.fromisoformat(session_date_str)
                assert session_date >= today, \
                    f"Past session in activity feed: session_date={session_date_str} < today={today}"

    def test_going_action_text_contains_day_name(self, client, user_auth):
        """Le texte d'action pour 'going' contient un jour ou 'aujourd'hui'/'demain'."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        valid_days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
                      "aujourd'hui", "demain"]
        for activity in activities:
            if activity["type"] == "going":
                action = activity["action_text"].lower()
                assert action.startswith("vient "), \
                    f"Going action_text should start with 'vient': {activity['action_text']}"
                day_part = action[len("vient "):]
                assert any(day_part.startswith(d) for d in valid_days), \
                    f"Day part '{day_part}' not in valid day names"


# ── Test 3: Règle - 'a rejoint' seulement pour les 30 derniers jours ──────────

class TestJoinedFilterRecentOnly:
    def test_joined_activities_within_30_days(self, client, user_auth):
        """Les activités 'joined' datent de moins de 30 jours."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        now = datetime.now(timezone.utc)
        from datetime import timedelta
        cutoff = now - timedelta(days=30)

        for activity in activities:
            if activity["type"] == "joined":
                ts = datetime.fromisoformat(activity["timestamp"].replace("Z", "+00:00"))
                assert ts >= cutoff, \
                    f"Old join activity in feed: timestamp={activity['timestamp']} older than 30 days"

    def test_joined_action_text_correct(self, client, user_auth):
        """Le texte d'action pour 'joined' est 'a rejoint la communauté'."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        for activity in activities:
            if activity["type"] == "joined":
                assert activity["action_text"] == "a rejoint la communauté", \
                    f"Expected 'a rejoint la communauté', got: {activity['action_text']}"


# ── Test 4: Vérification de non-doublons ────────────────────────────────────

class TestActivityNoDuplicates:
    def test_no_duplicate_going_for_same_session(self, client, user_auth):
        """Pas de doublon (user_id, type, session_date) dans le fil."""
        # Cliquer "Je viens" deux fois
        client.post(f"/spot-you/{POINT_ID}/going", headers=user_auth)
        client.post(f"/spot-you/{POINT_ID}/going", headers=user_auth)

        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        seen = set()
        for a in activities:
            key = (a["user_id"], a["type"], a.get("session_date"))
            assert key not in seen, f"Duplicate activity found: {key}"
            seen.add(key)

    def test_activity_max_30_items(self, client, user_auth):
        """Le fil d'activité ne contient pas plus de 30 items."""
        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]
        assert len(activities) <= 30, f"Activity feed has {len(activities)} items, max should be 30"


# ── Test 5: Vérification après join + going ───────────────────────────────────

class TestActivityAfterJoinAndGoing:
    def test_user_going_appears_in_activity(self, client, user_auth):
        """Après 'Je viens', l'utilisateur apparaît dans le fil d'activité (type=going)."""
        client.post(f"/spot-you/{POINT_ID}/going", headers=user_auth)

        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        # Check that at least one "going" activity exists
        going_activities = [a for a in activities if a["type"] == "going"]
        assert len(going_activities) >= 1, "Expected at least one 'going' activity after 'Je viens'"

    def test_user_join_appears_in_activity(self, client, user_auth):
        """Après 'Rejoindre', l'utilisateur apparaît dans le fil d'activité (type=joined)."""
        client.post(f"/spot-you/{POINT_ID}/join", headers=user_auth)

        r = client.get(f"/spot-you/{POINT_ID}/activity", headers=user_auth)
        assert r.status_code == 200
        activities = r.json()["activities"]

        # Check that at least one "joined" activity exists
        joined_activities = [a for a in activities if a["type"] == "joined"]
        assert len(joined_activities) >= 1, "Expected at least one 'joined' activity after 'Rejoindre'"

    def test_404_for_nonexistent_spot(self, client, user_auth):
        """GET /spot-you/nonexistent/activity retourne 404."""
        r = client.get("/spot-you/nonexistent_id/activity", headers=user_auth)
        assert r.status_code == 404, f"Expected 404 for nonexistent spot, got: {r.status_code}"
