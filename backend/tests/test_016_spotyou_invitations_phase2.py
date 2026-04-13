"""
Tests e2e — Phase 2 Invitations SpotYou
========================================
T1 : POST /tag-points/{id}/invite — admin invite coach → success
T2 : POST /tag-points/{id}/invite — membre non autorisé (admin_only) → 403
T3 : POST /tag-points/{id}/invite — anti-doublon accepted → 409
T4 : POST /tag-points/{id}/invite — anti-doublon already invited → 409
T5 : GET /users/me/spotyou-invitations — liste invitations reçues avec inviter.name, join_status=invited
T6 : POST /tag-points/{id}/invitations/accept — accepte → status=accepted, participants_count++
T7 : POST /tag-points/{id}/invitations/refuse — refuse → status=rejected
T8 : GET /users/search?q=admin → retourne liste avec is_social
T9 : membre accepted (admin_and_members) peut inviter → success
"""

import asyncio
import httpx
import pytest

BASE_URL = "https://api-slice-preview.preview.emergentagent.com/api"

ADMIN  = {"email": "admin@winek.app",   "password": "WinekAdmin2024!"}
COACH  = {"email": "coach@winek.app",   "password": "WinekCoach2024!"}
USER   = {"email": "user@winek.app",    "password": "WinekUser2024!"}
USER2  = {"email": "mbenali@winek.app", "password": "WinekDemo2024!"}


# ─── Helpers ────────────────────────────────────────────────────────────────────

async def login(client: httpx.AsyncClient, creds: dict) -> str:
    r = await client.post("/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.text}"
    return r.json()["token"]


async def get_user_id(client: httpx.AsyncClient, token: str) -> str:
    r = await client.get("/users/profile", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"Profile fetch failed: {r.text}"
    return r.json()["user_id"]


async def create_spotyou(client: httpx.AsyncClient, token: str,
                          invite_permissions: str = "admin_and_members",
                          visibility_type: str = "public",
                          join_mode: str = "open") -> str:
    """Crée un SpotYou de test et retourne son point_id."""
    payload = {
        "title": f"TEST_Invite_Phase2_{invite_permissions}",
        "description": "Créé par test auto Phase 2",
        "latitude": 48.8566,
        "longitude": 2.3522,
        "domain_id": "running",
        "tag_ids": ["tag_10km"],
        "visibility_type": visibility_type,
        "join_mode": join_mode,
        "invite_permissions": invite_permissions,
    }
    r = await client.post("/tag-points", json=payload,
                          headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, f"Create SpotYou failed: {r.text}"
    return r.json()["point_id"]


async def cleanup_spotyou(client: httpx.AsyncClient, token: str, point_id: str):
    """Désactive le SpotYou de test (DELETE)."""
    try:
        await client.delete(f"/tag-points/{point_id}",
                             headers={"Authorization": f"Bearer {token}"})
    except Exception:
        pass  # silencieux


async def cleanup_member(client: httpx.AsyncClient, token: str, point_id: str):
    """Quitte le SpotYou (leave) pour nettoyer la DB."""
    try:
        await client.delete(f"/tag-points/{point_id}/leave",
                             headers={"Authorization": f"Bearer {token}"})
    except Exception:
        pass


# ─── Tests ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_t1_admin_invite_coach_success():
    """T1 : Admin invite coach → 200 success, message présent."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_and_members")
        try:
            r = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert r.status_code == 200, f"T1 attendait 200, obtenu {r.status_code}: {r.text}"
            data = r.json()
            assert data.get("success") is True, f"T1: 'success' manquant: {data}"
            assert "message" in data, f"T1: 'message' manquant: {data}"
            print(f"T1 PASS: admin→coach invite OK — {data['message']}")
        finally:
            # Nettoyer invitation (le coach n'est pas encore membre)
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t2_non_authorized_member_admin_only_403():
    """T2 : Membre non-owner tente d'inviter sur un SpotYou admin_only → 403."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        user_tok  = await login(client, USER)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        # SpotYou avec invite_permissions=admin_only
        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_only")
        try:
            r = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {user_tok}"},
            )
            assert r.status_code == 403, f"T2 attendait 403, obtenu {r.status_code}: {r.text}"
            detail = r.json().get("detail", "")
            assert "admin" in detail.lower(), f"T2: message 403 inattendu: {detail}"
            print(f"T2 PASS: 403 correct — {detail}")
        finally:
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t3_anti_doublon_already_accepted_409():
    """T3 : Tenter d'inviter un utilisateur déjà accepté → 409."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        user_tok  = await login(client, USER)
        user_id   = await get_user_id(client, user_tok)

        # SpotYou public + open → user peut rejoindre directement (accepted)
        point_id = await create_spotyou(client, admin_tok,
                                         invite_permissions="admin_and_members",
                                         visibility_type="public",
                                         join_mode="open")
        try:
            # User rejoint (status=accepted)
            jr = await client.post(f"/tag-points/{point_id}/join",
                                   headers={"Authorization": f"Bearer {user_tok}"})
            assert jr.status_code == 200, f"T3: join failed: {jr.text}"
            assert jr.json().get("status") == "accepted", f"T3: expected accepted: {jr.json()}"

            # Admin tente d'inviter l'utilisateur déjà membre → 409
            r = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": user_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert r.status_code == 409, f"T3 attendait 409, obtenu {r.status_code}: {r.text}"
            detail = r.json().get("detail", "")
            assert "déjà membre" in detail.lower() or "accepted" in detail.lower(), \
                f"T3: message 409 inattendu: {detail}"
            print(f"T3 PASS: 409 correct — {detail}")
        finally:
            await cleanup_member(client, user_tok, point_id)
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t4_anti_doublon_already_invited_409():
    """T4 : Tenter d'inviter un utilisateur déjà invité → 409."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_and_members")
        try:
            # Première invitation → 200
            r1 = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert r1.status_code == 200, f"T4 setup: première invite failed: {r1.text}"

            # Deuxième invitation → 409 (already invited)
            r2 = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert r2.status_code == 409, f"T4 attendait 409, obtenu {r2.status_code}: {r2.text}"
            detail = r2.json().get("detail", "")
            assert "invit" in detail.lower(), f"T4: message 409 inattendu: {detail}"
            print(f"T4 PASS: 409 correct — {detail}")
        finally:
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t5_get_my_invitations():
    """T5 : GET /users/me/spotyou-invitations — liste les invitations avec point_id, title, inviter.name, join_status=invited."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_and_members")
        try:
            # Admin invite le coach
            inv = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert inv.status_code == 200, f"T5 setup: invite failed: {inv.text}"

            # Coach récupère ses invitations
            r = await client.get("/users/me/spotyou-invitations",
                                  headers={"Authorization": f"Bearer {coach_tok}"})
            assert r.status_code == 200, f"T5 attendait 200, obtenu {r.status_code}: {r.text}"

            invitations = r.json()
            assert isinstance(invitations, list), f"T5: attendait une liste, obtenu {type(invitations)}"

            # Trouver notre invitation créée dans le test
            matching = [i for i in invitations if i.get("point_id") == point_id]
            assert len(matching) >= 1, f"T5: invitation pour point_id={point_id} introuvable dans: {invitations}"

            inv_item = matching[0]
            # Vérifier les champs requis
            assert "point_id" in inv_item,   f"T5: 'point_id' manquant: {inv_item}"
            assert "title" in inv_item,       f"T5: 'title' manquant: {inv_item}"
            assert inv_item.get("join_status") == "invited", f"T5: join_status attendu 'invited', obtenu: {inv_item.get('join_status')}"

            inviter = inv_item.get("inviter")
            assert inviter is not None, f"T5: 'inviter' manquant: {inv_item}"
            assert "name" in inviter and inviter["name"], f"T5: inviter.name manquant: {inviter}"
            print(f"T5 PASS: invitation trouvée — title={inv_item['title']}, inviter={inviter['name']}, join_status={inv_item['join_status']}")
        finally:
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t6_accept_invitation():
    """T6 : Invité accepte → status=accepted, participants_count incrémenté."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_and_members")
        try:
            # Récupérer le count avant invitation
            tp_before = await client.get(f"/tag-points/{point_id}",
                                          headers={"Authorization": f"Bearer {admin_tok}"})
            count_before = tp_before.json().get("participants_count", 0)

            # Admin invite le coach
            inv = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert inv.status_code == 200, f"T6 setup: invite failed: {inv.text}"

            # Coach accepte
            r = await client.post(f"/tag-points/{point_id}/invitations/accept",
                                   headers={"Authorization": f"Bearer {coach_tok}"})
            assert r.status_code == 200, f"T6 attendait 200, obtenu {r.status_code}: {r.text}"

            data = r.json()
            assert data.get("success") is True,      f"T6: 'success' manquant: {data}"
            assert data.get("status") == "accepted",  f"T6: status attendu 'accepted': {data}"
            new_count = data.get("participants_count")
            assert new_count is not None, f"T6: participants_count manquant: {data}"
            assert new_count > count_before, \
                f"T6: participants_count devrait augmenter ({count_before}→{new_count})"
            print(f"T6 PASS: accept OK — status={data['status']}, participants_count={new_count}")
        finally:
            # Le coach est désormais membre — le quitter avant de supprimer le SpotYou
            await cleanup_member(client, coach_tok, point_id)
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t7_refuse_invitation():
    """T7 : Invité refuse → status=rejected."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        user_tok  = await login(client, USER)
        user_id   = await get_user_id(client, user_tok)

        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_and_members")
        try:
            # Admin invite l'utilisateur
            inv = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": user_id},
                headers={"Authorization": f"Bearer {admin_tok}"},
            )
            assert inv.status_code == 200, f"T7 setup: invite failed: {inv.text}"

            # User refuse
            r = await client.post(f"/tag-points/{point_id}/invitations/refuse",
                                   headers={"Authorization": f"Bearer {user_tok}"})
            assert r.status_code == 200, f"T7 attendait 200, obtenu {r.status_code}: {r.text}"

            data = r.json()
            assert data.get("success") is True,      f"T7: 'success' manquant: {data}"
            assert data.get("status") == "rejected",  f"T7: status attendu 'rejected': {data}"
            print(f"T7 PASS: refuse OK — status={data['status']}")
        finally:
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t8_user_search_with_is_social():
    """T8 : GET /users/search?q=admin → retourne une liste avec is_social."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        coach_tok = await login(client, COACH)

        r = await client.get("/users/search?q=admin",
                              headers={"Authorization": f"Bearer {coach_tok}"})
        assert r.status_code == 200, f"T8 attendait 200, obtenu {r.status_code}: {r.text}"

        data = r.json()
        assert isinstance(data, list), f"T8: attendait une liste: {type(data)}"
        # La recherche doit retourner des résultats (admin@winek.app est dans la DB)
        assert len(data) > 0, f"T8: aucun résultat pour 'admin'"

        # Vérifier que chaque utilisateur a un champ is_social
        for user in data:
            assert "user_id" in user,   f"T8: 'user_id' manquant: {user}"
            assert "name" in user,      f"T8: 'name' manquant: {user}"
            assert "is_social" in user, f"T8: 'is_social' manquant: {user}"
            assert isinstance(user["is_social"], bool), f"T8: is_social doit être bool: {user}"

        print(f"T8 PASS: {len(data)} résultats, is_social présent — premier: {data[0]}")


@pytest.mark.asyncio
async def test_t8_user_search_unauthenticated_returns_list():
    """T8b : GET /users/search?q=admin sans auth → résultats valides (auth optionnelle)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        r = await client.get("/users/search?q=admin")
        assert r.status_code == 200, f"T8b attendait 200, obtenu {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list), f"T8b: attendait une liste: {type(data)}"
        for user in data:
            assert "is_social" in user, f"T8b: is_social manquant: {user}"
        print(f"T8b PASS: {len(data)} résultats sans auth")


@pytest.mark.asyncio
async def test_t9_accepted_member_can_invite():
    """T9 : Membre accepté (admin_and_members) peut inviter un autre utilisateur → success."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        user_tok  = await login(client, USER)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        # SpotYou public+open, invite_permissions=admin_and_members
        point_id = await create_spotyou(client, admin_tok,
                                         invite_permissions="admin_and_members",
                                         visibility_type="public",
                                         join_mode="open")
        try:
            # User rejoint (devient membre accepted)
            jr = await client.post(f"/tag-points/{point_id}/join",
                                   headers={"Authorization": f"Bearer {user_tok}"})
            assert jr.status_code == 200, f"T9 setup: join failed: {jr.text}"
            assert jr.json().get("status") == "accepted", f"T9: expected accepted: {jr.json()}"

            # User (membre accepté) invite le coach
            r = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {user_tok}"},
            )
            assert r.status_code == 200, f"T9 attendait 200, obtenu {r.status_code}: {r.text}"
            data = r.json()
            assert data.get("success") is True, f"T9: 'success' manquant: {data}"
            print(f"T9 PASS: membre accepté peut inviter — {data.get('message', '')}")
        finally:
            await cleanup_member(client, user_tok, point_id)
            await cleanup_spotyou(client, admin_tok, point_id)


@pytest.mark.asyncio
async def test_t2b_non_member_admin_and_members_403():
    """T2b : Non-membre sur SpotYou admin_and_members → 403 (pas member accepté)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        admin_tok = await login(client, ADMIN)
        user_tok  = await login(client, USER)
        coach_tok = await login(client, COACH)
        coach_id  = await get_user_id(client, coach_tok)

        # SpotYou admin_and_members mais user n'est pas membre
        point_id = await create_spotyou(client, admin_tok, invite_permissions="admin_and_members")
        try:
            r = await client.post(
                f"/tag-points/{point_id}/invite",
                json={"invited_user_id": coach_id},
                headers={"Authorization": f"Bearer {user_tok}"},
            )
            assert r.status_code == 403, f"T2b attendait 403, obtenu {r.status_code}: {r.text}"
            print(f"T2b PASS: non-membre admin_and_members → 403: {r.json().get('detail')}")
        finally:
            await cleanup_spotyou(client, admin_tok, point_id)
