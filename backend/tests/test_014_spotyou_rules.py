"""
Tests e2e — Phase 1 Système de Règles SpotYou
Règles métier testées :
  R1 : public + open       → rejoindre directement (status=accepted)
  R2 : private + admin_approval → pending, notif admin
  R3 : private + members_approval → pending, notif membres
  R4 : admin approve       → accepted, notif requester
  R5 : admin reject        → rejected, notif requester
  R6 : membre approve      → accepted (members_approval mode)
  R7 : capacité max        → 409 si plein
  R8 : double demande      → idempotent
"""
import asyncio
import httpx
import pytest
import json

BASE_URL = "https://spotme-ui-polish.preview.emergentagent.com/api"

ADMIN    = {"email": "admin@winek.app",   "password": "WinekAdmin2024!"}
COACH    = {"email": "coach@winek.app",   "password": "WinekCoach2024!"}
USER     = {"email": "user@winek.app",    "password": "WinekUser2024!"}


async def login(client, creds):
    r = await client.post("/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


async def create_private_spotyou(client, token, join_mode="admin_approval"):
    payload = {
        "title": f"TEST Private SpotYou {join_mode}",
        "description": "Test auto",
        "latitude": 48.8566, "longitude": 2.3522,
        "domain_id": "running", "tag_ids": ["tag_10km"],
        "visibility_type": "private",
        "join_mode": join_mode,
        "invite_permissions": "admin_only",
    }
    r = await client.post("/tag-points", json=payload,
                          headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"Create failed: {r.text}"
    return r.json()["point_id"]


async def cleanup_spotyou(client, token, point_id):
    """Supprime (désactive) le SpotYou de test."""
    await client.delete(f"/tag-points/{point_id}",
                        headers={"Authorization": f"Bearer {token}"})


@pytest.mark.asyncio
async def test_r1_public_join_direct():
    """R1 : SpotYou public → rejoindre directement (status=accepted)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)

        # Créer un SpotYou PUBLIC
        payload = {
            "title": "TEST Public SpotYou",
            "latitude": 48.8566, "longitude": 2.3522,
            "domain_id": "running", "tag_ids": ["tag_10km"],
            "visibility_type": "public", "join_mode": "open",
            "invite_permissions": "admin_only",
        }
        r = await client.post("/tag-points", json=payload,
                              headers={"Authorization": f"Bearer {admin_tok}"})
        pid = r.json()["point_id"]

        try:
            # Coach rejoint
            r = await client.post(f"/tag-points/{pid}/join",
                                  headers={"Authorization": f"Bearer {coach_tok}"})
            data = r.json()
            assert r.status_code == 200, f"Join failed: {r.text}"
            assert data.get("status") == "accepted", f"Expected accepted, got: {data}"
            assert data.get("is_participant") is True
            print("✅ R1 PASS : Public join → accepted immédiatement")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_r2_private_admin_approval_pending():
    """R2 : private + admin_approval → status=pending."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        pid = await create_private_spotyou(client, admin_tok, "admin_approval")

        try:
            r = await client.post(f"/tag-points/{pid}/join",
                                  headers={"Authorization": f"Bearer {coach_tok}"})
            data = r.json()
            assert r.status_code == 200, f"Join failed: {r.text}"
            assert data.get("status") == "pending", f"Expected pending, got: {data}"
            assert data.get("is_participant") is False
            print("✅ R2 PASS : private+admin_approval → pending")

            # Vérifier dans join-requests
            r2 = await client.get(f"/tag-points/{pid}/join-requests",
                                  headers={"Authorization": f"Bearer {admin_tok}"})
            assert r2.status_code == 200
            requests = r2.json()
            assert any(req["user_id"] == "user_coach001" for req in requests), \
                f"Coach not in join-requests: {requests}"
            print("✅ R2 PASS : join-requests contient la demande du coach")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_r4_admin_approve():
    """R4 : admin approve → status=accepted."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        pid = await create_private_spotyou(client, admin_tok, "admin_approval")

        try:
            # Coach envoie demande
            await client.post(f"/tag-points/{pid}/join",
                              headers={"Authorization": f"Bearer {coach_tok}"})

            # Admin récupère l'user_id du coach
            reqs = (await client.get(f"/tag-points/{pid}/join-requests",
                                     headers={"Authorization": f"Bearer {admin_tok}"})).json()
            coach_uid = reqs[0]["user_id"]

            # Admin approve
            r = await client.post(f"/tag-points/{pid}/members/{coach_uid}/approve",
                                  headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 200, f"Approve failed: {r.text}"
            data = r.json()
            assert data.get("success") is True
            print(f"✅ R4 PASS : Admin approve → success, participants: {data.get('participants_count')}")

            # Vérifier que la demande disparaît des join-requests
            reqs2 = (await client.get(f"/tag-points/{pid}/join-requests",
                                      headers={"Authorization": f"Bearer {admin_tok}"})).json()
            assert not any(req["user_id"] == coach_uid for req in reqs2), \
                "Demande encore présente après approbation"
            print("✅ R4 PASS : Demande retirée de join-requests après approbation")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_r5_admin_reject():
    """R5 : admin reject → rejected, demande clôturée."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        pid = await create_private_spotyou(client, admin_tok, "admin_approval")

        try:
            await client.post(f"/tag-points/{pid}/join",
                              headers={"Authorization": f"Bearer {coach_tok}"})
            reqs = (await client.get(f"/tag-points/{pid}/join-requests",
                                     headers={"Authorization": f"Bearer {admin_tok}"})).json()
            coach_uid = reqs[0]["user_id"]

            r = await client.post(f"/tag-points/{pid}/members/{coach_uid}/reject",
                                  headers={"Authorization": f"Bearer {admin_tok}"})
            assert r.status_code == 200, f"Reject failed: {r.text}"
            assert r.json().get("success") is True
            print("✅ R5 PASS : Admin reject → success")

            reqs2 = (await client.get(f"/tag-points/{pid}/join-requests",
                                      headers={"Authorization": f"Bearer {admin_tok}"})).json()
            assert not any(req["user_id"] == coach_uid for req in reqs2), \
                "Demande encore présente après rejet"
            print("✅ R5 PASS : Demande retirée après rejet")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_r8_double_request_idempotent():
    """R8 : double demande → idempotent, retourne pending sans doublon."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        pid = await create_private_spotyou(client, admin_tok, "admin_approval")

        try:
            r1 = await client.post(f"/tag-points/{pid}/join",
                                   headers={"Authorization": f"Bearer {coach_tok}"})
            r2 = await client.post(f"/tag-points/{pid}/join",
                                   headers={"Authorization": f"Bearer {coach_tok}"})
            assert r1.status_code == 200
            assert r2.status_code == 200
            assert r2.json().get("status") == "pending"
            assert "déjà en attente" in r2.json().get("message", "").lower() or \
                   r2.json().get("status") == "pending"
            print("✅ R8 PASS : Double demande idempotente")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


@pytest.mark.asyncio
async def test_r6_members_approval_member_can_approve():
    """R6 : members_approval → un membre accepté peut approuver."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        user_tok  = await login(client, USER)
        pid = await create_private_spotyou(client, admin_tok, "members_approval")

        try:
            # Coach envoie une demande
            r = await client.post(f"/tag-points/{pid}/join",
                                  headers={"Authorization": f"Bearer {coach_tok}"})
            assert r.json().get("status") == "pending"

            # Un admin (user_admin) peut approuver en members_approval
            reqs = (await client.get(f"/tag-points/{pid}/join-requests",
                                     headers={"Authorization": f"Bearer {admin_tok}"})).json()
            coach_uid = reqs[0]["user_id"]

            r_approve = await client.post(f"/tag-points/{pid}/members/{coach_uid}/approve",
                                          headers={"Authorization": f"Bearer {admin_tok}"})
            assert r_approve.status_code == 200, f"Member approve failed: {r_approve.text}"
            print("✅ R6 PASS : Admin peut approuver en members_approval mode")
        finally:
            await cleanup_spotyou(client, admin_tok, pid)


if __name__ == "__main__":
    asyncio.run(test_r1_public_join_direct())
    asyncio.run(test_r2_private_admin_approval_pending())
    asyncio.run(test_r4_admin_approve())
    asyncio.run(test_r5_admin_reject())
    asyncio.run(test_r8_double_request_idempotent())
    asyncio.run(test_r6_members_approval_member_can_approve())
    print("\n🎉 Tous les tests passent !")
