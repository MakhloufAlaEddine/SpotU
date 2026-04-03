"""
Tests additionnels — Phase 1 Système de Règles SpotYou (iteration 105)
Vérifie :
  - GET /api/tag-points/pt_demo001 → champs visibility_type, join_mode, invite_permissions
  - GET /api/users/me/events → seulement status=accepted (pas pending)
  - GET /api/users/me/pending-requests → 200 avec liste
  - POST /api/tag-points/{id}/join (public) → status=accepted, is_participant=True
  - POST /api/tag-points/{id}/join (private+admin_approval) → status=pending
  - GET /api/tag-points/{id}/join-requests → 403 pour non-admin
  - POST /api/tag-points/{id}/members/{uid}/approve → success=True
  - POST /api/tag-points/{id}/members/{uid}/reject → success=True
  - GET /api/tag-points/{id}/participants → seulement accepted
"""
import asyncio
import httpx
import pytest

BASE_URL = "https://spotme-ui-polish.preview.emergentagent.com/api"

ADMIN = {"email": "admin@winek.app", "password": "WinekAdmin2024!"}
COACH = {"email": "coach@winek.app", "password": "WinekCoach2024!"}
USER  = {"email": "user@winek.app",  "password": "WinekUser2024!"}


async def login(client, creds):
    r = await client.post("/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


async def cleanup_spotyou(client, token, point_id):
    await client.delete(f"/tag-points/{point_id}",
                        headers={"Authorization": f"Bearer {token}"})


@pytest.mark.asyncio
async def test_pt_demo001_has_new_fields():
    """pt_demo001 possède visibility_type, join_mode, invite_permissions."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15) as client:
        user_tok = await login(client, USER)
        r = await client.get("/tag-points/pt_demo001",
                             headers={"Authorization": f"Bearer {user_tok}"})
        assert r.status_code == 200, f"GET pt_demo001 failed: {r.text}"
        data = r.json()
        assert "visibility_type" in data, f"visibility_type absent: {list(data.keys())}"
        assert "join_mode" in data, f"join_mode absent: {list(data.keys())}"
        assert "invite_permissions" in data, f"invite_permissions absent: {list(data.keys())}"
        assert data["visibility_type"] == "public", f"Expected public, got: {data['visibility_type']}"
        assert data["join_mode"] == "open", f"Expected open, got: {data['join_mode']}"
        print(f"✅ pt_demo001 fields OK: visibility={data['visibility_type']}, join_mode={data['join_mode']}, invite={data['invite_permissions']}")


@pytest.mark.asyncio
async def test_my_events_only_accepted():
    """GET /users/me/events ne retourne que status=accepted."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15) as client:
        user_tok = await login(client, USER)
        r = await client.get("/users/me/events",
                             headers={"Authorization": f"Bearer {user_tok}"})
        assert r.status_code == 200, f"GET /users/me/events failed: {r.text}"
        events = r.json()
        assert isinstance(events, list), f"Expected list, got: {type(events)}"
        # Vérifier qu'aucun item avec member_status=pending n'est présent
        pending_items = [e for e in events if e.get("member_status") == "pending"]
        assert len(pending_items) == 0, f"Pending members in events: {pending_items}"
        print(f"✅ /users/me/events: {len(events)} items, 0 pending")


@pytest.mark.asyncio
async def test_pending_requests_returns_200():
    """GET /users/me/pending-requests → 200 avec liste (vide ou non)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=15) as client:
        user_tok = await login(client, USER)
        r = await client.get("/users/me/pending-requests",
                             headers={"Authorization": f"Bearer {user_tok}"})
        assert r.status_code == 200, f"pending-requests failed: {r.text}"
        data = r.json()
        assert isinstance(data, list), f"Expected list, got: {type(data)}"
        # Tous les items doivent avoir join_status=pending
        for item in data:
            assert item.get("join_status") == "pending", f"Non-pending item: {item}"
        print(f"✅ /users/me/pending-requests: 200, {len(data)} items")


@pytest.mark.asyncio
async def test_join_public_spotyou_returns_accepted():
    """JOIN un SpotYou public → status=accepted, is_participant=True."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)

        # Créer un SpotYou public
        r = await client.post("/tag-points", json={
            "title": "TEST Join Public",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "public", "join_mode": "open",
            "invite_permissions": "admin_only",
        }, headers={"Authorization": f"Bearer {admin_tok}"})
        assert r.status_code == 200, f"Create failed: {r.text}"
        pid = r.json()["point_id"]

        try:
            # Leave d'abord au cas où coach serait déjà membre
            await client.delete(f"/tag-points/{pid}/leave",
                                headers={"Authorization": f"Bearer {coach_tok}"})

            # Coach rejoint
            r = await client.post(f"/tag-points/{pid}/join",
                                  headers={"Authorization": f"Bearer {coach_tok}"})
            assert r.status_code == 200, f"Join failed: {r.text}"
            data = r.json()
            assert data.get("status") == "accepted", f"Expected accepted: {data}"
            assert data.get("is_participant") is True, f"is_participant should be True: {data}"
            print(f"✅ Public join → accepted, is_participant=True")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_join_private_admin_approval_returns_pending():
    """JOIN un SpotYou private+admin_approval → status=pending."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)

        r = await client.post("/tag-points", json={
            "title": "TEST Join Private Admin",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "private", "join_mode": "admin_approval",
            "invite_permissions": "admin_only",
        }, headers={"Authorization": f"Bearer {admin_tok}"})
        pid = r.json()["point_id"]

        try:
            r = await client.post(f"/tag-points/{pid}/join",
                                  headers={"Authorization": f"Bearer {coach_tok}"})
            assert r.status_code == 200, f"Join failed: {r.text}"
            data = r.json()
            assert data.get("status") == "pending", f"Expected pending: {data}"
            assert data.get("is_participant") is False, f"is_participant should be False: {data}"
            print(f"✅ Private+admin_approval join → pending, is_participant=False")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_join_requests_forbidden_for_non_admin():
    """GET /join-requests → 403 pour un non-admin."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        user_tok  = await login(client, USER)

        r = await client.post("/tag-points", json={
            "title": "TEST JoinReq Forbidden",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "private", "join_mode": "admin_approval",
            "invite_permissions": "admin_only",
        }, headers={"Authorization": f"Bearer {admin_tok}"})
        pid = r.json()["point_id"]

        try:
            # Coach envoie une demande
            await client.post(f"/tag-points/{pid}/join",
                              headers={"Authorization": f"Bearer {coach_tok}"})

            # User (non-admin, non-membre) essaie d'accéder aux join-requests → 403
            r_forbidden = await client.get(f"/tag-points/{pid}/join-requests",
                                           headers={"Authorization": f"Bearer {user_tok}"})
            assert r_forbidden.status_code == 403, \
                f"Expected 403 for non-admin, got: {r_forbidden.status_code} {r_forbidden.text}"

            # Admin peut accéder
            r_admin = await client.get(f"/tag-points/{pid}/join-requests",
                                       headers={"Authorization": f"Bearer {admin_tok}"})
            assert r_admin.status_code == 200, f"Admin should have access: {r_admin.text}"
            print("✅ join-requests: 403 pour non-admin, 200 pour admin")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_approve_returns_success():
    """POST /members/{uid}/approve → success=True."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)

        r = await client.post("/tag-points", json={
            "title": "TEST Approve",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "private", "join_mode": "admin_approval",
            "invite_permissions": "admin_only",
        }, headers={"Authorization": f"Bearer {admin_tok}"})
        pid = r.json()["point_id"]

        try:
            await client.post(f"/tag-points/{pid}/join",
                              headers={"Authorization": f"Bearer {coach_tok}"})
            reqs = (await client.get(f"/tag-points/{pid}/join-requests",
                                     headers={"Authorization": f"Bearer {admin_tok}"})).json()
            assert len(reqs) > 0, "No pending requests found"
            coach_uid = reqs[0]["user_id"]

            r_approve = await client.post(f"/tag-points/{pid}/members/{coach_uid}/approve",
                                          headers={"Authorization": f"Bearer {admin_tok}"})
            assert r_approve.status_code == 200, f"Approve failed: {r_approve.text}"
            data = r_approve.json()
            assert data.get("success") is True, f"success should be True: {data}"
            print(f"✅ approve → success=True, participants={data.get('participants_count')}")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_reject_returns_success():
    """POST /members/{uid}/reject → success=True."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)

        r = await client.post("/tag-points", json={
            "title": "TEST Reject",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "private", "join_mode": "admin_approval",
            "invite_permissions": "admin_only",
        }, headers={"Authorization": f"Bearer {admin_tok}"})
        pid = r.json()["point_id"]

        try:
            await client.post(f"/tag-points/{pid}/join",
                              headers={"Authorization": f"Bearer {coach_tok}"})
            reqs = (await client.get(f"/tag-points/{pid}/join-requests",
                                     headers={"Authorization": f"Bearer {admin_tok}"})).json()
            coach_uid = reqs[0]["user_id"]

            r_reject = await client.post(f"/tag-points/{pid}/members/{coach_uid}/reject",
                                         headers={"Authorization": f"Bearer {admin_tok}"})
            assert r_reject.status_code == 200, f"Reject failed: {r_reject.text}"
            data = r_reject.json()
            assert data.get("success") is True, f"success should be True: {data}"
            print("✅ reject → success=True")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_participants_only_accepted():
    """GET /participants → seulement les membres accepted."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)

        r = await client.post("/tag-points", json={
            "title": "TEST Participants Filter",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "private", "join_mode": "admin_approval",
            "invite_permissions": "admin_only",
        }, headers={"Authorization": f"Bearer {admin_tok}"})
        pid = r.json()["point_id"]

        try:
            # Coach envoie une demande (pending)
            await client.post(f"/tag-points/{pid}/join",
                              headers={"Authorization": f"Bearer {coach_tok}"})

            # GET participants → coach NE doit PAS être là (encore pending)
            r_parts = await client.get(f"/tag-points/{pid}/participants")
            assert r_parts.status_code == 200, f"Participants failed: {r_parts.text}"
            parts = r_parts.json()
            # Récupérer les IDs du coach
            reqs = (await client.get(f"/tag-points/{pid}/join-requests",
                                     headers={"Authorization": f"Bearer {admin_tok}"})).json()
            coach_uid = reqs[0]["user_id"] if reqs else None
            if coach_uid:
                part_ids = [p["user_id"] for p in parts]
                assert coach_uid not in part_ids, \
                    f"Pending member {coach_uid} found in participants: {part_ids}"
            print(f"✅ /participants: {len(parts)} accepted only (pending excluded)")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


if __name__ == "__main__":
    asyncio.run(test_pt_demo001_has_new_fields())
    asyncio.run(test_my_events_only_accepted())
    asyncio.run(test_pending_requests_returns_200())
    asyncio.run(test_join_public_spotyou_returns_accepted())
    asyncio.run(test_join_private_admin_approval_returns_pending())
    asyncio.run(test_join_requests_forbidden_for_non_admin())
    asyncio.run(test_approve_returns_success())
    asyncio.run(test_reject_returns_success())
    asyncio.run(test_participants_only_accepted())
    print("\n🎉 Tous les tests supplémentaires passent !")
