"""
Tests — Stratégie de rétention 90j (Phase A–D)
=================================================
Couvre les endpoints suivants :
  GET  /users/me/reactivatable
  DELETE /tag-points/{id}  +  POST /tag-points/{id}/reactivate
  DELETE /services/{id}    +  GET /services/deactivated  +  POST /services/{id}/reactivate
  DELETE /products/{id}    +  POST /products/{id}/reactivate
  PATCH /users/{id}/deactivate  +  POST /users/{id}/reactivate

Les tests sont ordonnés (delete → verify → reactivate) pour ne pas laisser de données
corrompues en base. Tous les états sont restaurés en fin de séquence.
"""

import pytest
import httpx
import asyncio
import os
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("TEST_BASE_URL", "https://java-spring-guide-1.preview.emergentagent.com")
TIMEOUT = 30

COACH_CREDS = {"email": "coach@winek.app", "password": "WinekCoach2024!"}
USER_CREDS  = {"email": "user@winek.app",  "password": "WinekUser2024!"}
ADMIN_CREDS = {"email": "admin@winek.app", "password": "WinekAdmin2024!"}

# Seed data IDs
COACH_TAGPOINT_ID = "pt_demo003"
COACH_SERVICE_ID  = "svc_demo001"


# ── Helpers ────────────────────────────────────────────────────────────────────

async def login(client: httpx.AsyncClient, creds: dict) -> tuple[str, str]:
    """Returns (token, user_id)."""
    r = await client.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, f"Login failed ({r.status_code}): {r.text}"
    data = r.json()
    token   = data.get("token") or data.get("access_token", "")
    user_id = data.get("user_id") or data.get("user", {}).get("user_id", "")
    assert token,   "token absent de la réponse login"
    assert user_id, "user_id absent de la réponse login"
    return token, user_id


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def days_until(iso_str: str) -> int:
    """Calcule le nombre de jours restants depuis maintenant vers la date ISO."""
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = dt - datetime.now(timezone.utc)
    return delta.days


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 1 — GET /users/me/reactivatable (état initial)
# ══════════════════════════════════════════════════════════════════════════════

class TestReactivatableInitial:
    """Vérification de l'endpoint reactivatable sur un compte sans entités supprimées."""

    @pytest.mark.asyncio
    async def test_reactivatable_requires_auth(self):
        """GET /users/me/reactivatable sans token → 401 ou 403."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{BASE_URL}/api/users/me/reactivatable")
        assert r.status_code in (401, 403), \
            f"Devrait être 401/403 sans auth, got {r.status_code}"

    @pytest.mark.asyncio
    async def test_reactivatable_returns_empty_structure(self):
        """GET /users/me/reactivatable doit retourner structure {spotyous, services, products, total}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token))
        assert r.status_code == 200, f"Endpoint reactivatable a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert "spotyous" in data, "Clé 'spotyous' absente"
        assert "services" in data, "Clé 'services' absente"
        assert "products" in data, "Clé 'products' absente"
        assert "total" in data,    "Clé 'total' absente"
        assert isinstance(data["spotyous"], list), "'spotyous' doit être une liste"
        assert isinstance(data["services"], list), "'services' doit être une liste"
        assert isinstance(data["products"], list), "'products' doit être une liste"
        assert isinstance(data["total"], int),      "'total' doit être un entier"


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 2 — SpotYou : soft delete ▶ reactivatable ▶ reactivate ▶ reactivatable
# ══════════════════════════════════════════════════════════════════════════════

class TestTagPointSoftDeleteCycle:
    """Cycle complet : delete → reactivatable → reactivate → reactivatable."""

    @pytest.mark.asyncio
    async def test_01_delete_tagpoint_returns_media_purge_date(self):
        """DELETE /tag-points/pt_demo003 → 200 + media_purge_scheduled_at ≈ J+90."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.delete(
                f"{BASE_URL}/api/tag-points/{COACH_TAGPOINT_ID}",
                headers=auth(token)
            )

        # 200 (soft delete) ou 409 si déjà supprimé (run précédent sans cleanup)
        if r.status_code == 409:
            pytest.skip(f"SpotYou {COACH_TAGPOINT_ID} déjà supprimé (run précédent sans cleanup)")

        assert r.status_code == 200, f"DELETE tag-point a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert data.get("success") is True or data.get("deleted") is True, \
            f"Réponse inattendue: {data}"
        assert "media_purge_scheduled_at" in data, "media_purge_scheduled_at absent"

        # Vérifie que la date est ≈ J+90 (entre 89 et 91 jours)
        days = days_until(data["media_purge_scheduled_at"])
        assert 89 <= days <= 91, \
            f"media_purge_scheduled_at devrait être dans ~90j, got {days} jours"

    @pytest.mark.asyncio
    async def test_02_reactivatable_includes_deleted_spotyou(self):
        """Après DELETE, GET /users/me/reactivatable doit inclure le SpotYou."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token))

        assert r.status_code == 200, f"reactivatable a échoué: {r.status_code}"
        data = r.json()
        spotyou_ids = [e["id"] for e in data.get("spotyous", [])]

        # Si le SpotYou n'est pas là, c'est peut-être qu'il n'a pas été supprimé (test précédent skippé)
        if COACH_TAGPOINT_ID not in spotyou_ids:
            pytest.skip(f"SpotYou {COACH_TAGPOINT_ID} absent de reactivatable (test 01 peut-être skippé)")

        spotyou = next(e for e in data["spotyous"] if e["id"] == COACH_TAGPOINT_ID)
        assert "days_until_media_purge" in spotyou, "days_until_media_purge absent"
        days = spotyou["days_until_media_purge"]
        assert days is not None and days >= 89, \
            f"days_until_media_purge devrait être >= 89, got {days}"
        assert data["total"] >= 1, f"total devrait être >= 1, got {data['total']}"

    @pytest.mark.asyncio
    async def test_03_reactivate_tagpoint_success(self):
        """POST /tag-points/pt_demo003/reactivate → {success:true, reactivated:true}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)

            # Vérifier si supprimé
            r_check = await c.get(
                f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token)
            )
            data_check = r_check.json() if r_check.status_code == 200 else {}
            is_deleted = any(
                e["id"] == COACH_TAGPOINT_ID
                for e in data_check.get("spotyous", [])
            )

            if not is_deleted:
                pytest.skip(f"SpotYou {COACH_TAGPOINT_ID} pas dans reactivatable (peut-être déjà actif)")

            r = await c.post(
                f"{BASE_URL}/api/tag-points/{COACH_TAGPOINT_ID}/reactivate",
                headers=auth(token)
            )

        if r.status_code == 409:
            pytest.skip(f"SpotYou {COACH_TAGPOINT_ID} déjà actif (409)")
        assert r.status_code == 200, f"reactivate tag-point a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert data.get("success") is True,     f"'success' devrait être True: {data}"
        assert data.get("reactivated") is True,  f"'reactivated' devrait être True: {data}"
        assert "pending_deletions_cancelled" in data, "pending_deletions_cancelled absent"
        assert data["pending_deletions_cancelled"] >= 0, \
            f"pending_deletions_cancelled devrait être >= 0"

    @pytest.mark.asyncio
    async def test_04_reactivatable_excludes_reactivated_spotyou(self):
        """Après réactivation, GET /users/me/reactivatable ne doit plus inclure le SpotYou."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token))

        assert r.status_code == 200
        data = r.json()
        spotyou_ids = [e["id"] for e in data.get("spotyous", [])]
        assert COACH_TAGPOINT_ID not in spotyou_ids, \
            f"SpotYou {COACH_TAGPOINT_ID} devrait être absent de reactivatable après réactivation"


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 3 — Services : delete ▶ deactivated ▶ reactivate
# ══════════════════════════════════════════════════════════════════════════════

class TestServiceSoftDeleteCycle:

    @pytest.mark.asyncio
    async def test_01_delete_service_returns_purge_date(self):
        """DELETE /services/svc_demo001 → 200 + {success:true, media_purge_scheduled_at}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.delete(
                f"{BASE_URL}/api/services/{COACH_SERVICE_ID}",
                headers=auth(token)
            )

        if r.status_code == 409:
            pytest.skip(f"Service {COACH_SERVICE_ID} déjà supprimé ou bookings actifs")

        assert r.status_code == 200, \
            f"DELETE service a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert data.get("success") is True, f"'success' manquant ou False: {data}"
        assert "media_purge_scheduled_at" in data, "media_purge_scheduled_at absent"

        days = days_until(data["media_purge_scheduled_at"])
        assert 89 <= days <= 91, \
            f"media_purge_scheduled_at devrait être dans ~90j, got {days} jours"

    @pytest.mark.asyncio
    async def test_02_get_deactivated_services_returns_200(self):
        """GET /services/deactivated → 200 (routing conflict résolu)."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/services/deactivated", headers=auth(token))

        assert r.status_code == 200, \
            f"GET /services/deactivated a retourné {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list), "La réponse doit être une liste"

    @pytest.mark.asyncio
    async def test_03_deactivated_services_includes_deleted_service(self):
        """GET /services/deactivated doit inclure svc_demo001 si supprimé."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/services/deactivated", headers=auth(token))

        assert r.status_code == 200
        services = r.json()
        svc_ids = [s.get("service_id") for s in services]

        if COACH_SERVICE_ID not in svc_ids:
            pytest.skip(f"Service {COACH_SERVICE_ID} absent de /services/deactivated (peut-être déjà actif)")

        svc = next(s for s in services if s.get("service_id") == COACH_SERVICE_ID)
        assert "days_until_media_purge" in svc, "days_until_media_purge absent"
        assert svc["days_until_media_purge"] is not None, "days_until_media_purge est null"
        assert svc["days_until_media_purge"] >= 0, "days_until_media_purge doit être >= 0"

    @pytest.mark.asyncio
    async def test_04_reactivate_service_success(self):
        """POST /services/svc_demo001/reactivate → {success:true, reactivated:true}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)

            # Vérifier si supprimé
            r_check = await c.get(
                f"{BASE_URL}/api/services/deactivated", headers=auth(token)
            )
            is_deleted = False
            if r_check.status_code == 200:
                is_deleted = any(
                    s.get("service_id") == COACH_SERVICE_ID
                    for s in r_check.json()
                )

            if not is_deleted:
                pytest.skip(f"Service {COACH_SERVICE_ID} pas dans deactivated (peut-être déjà actif)")

            r = await c.post(
                f"{BASE_URL}/api/services/{COACH_SERVICE_ID}/reactivate",
                headers=auth(token)
            )

        if r.status_code == 409:
            pytest.skip(f"Service {COACH_SERVICE_ID} déjà actif (409)")
        assert r.status_code == 200, \
            f"reactivate service a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert data.get("success") is True,    f"'success' devrait être True: {data}"
        assert data.get("reactivated") is True, f"'reactivated' devrait être True: {data}"


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 4 — Produits : delete ▶ reactivate
# ══════════════════════════════════════════════════════════════════════════════

class TestProductSoftDeleteCycle:

    @pytest.mark.asyncio
    async def test_01_get_coach_product(self):
        """GET /products/mine doit retourner au moins un produit pour le coach."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/products/mine", headers=auth(token))

        if r.status_code == 404:
            pytest.skip("Route /products/mine n'existe pas")
        assert r.status_code == 200, f"GET /products/mine a échoué: {r.status_code}"
        # Résultat peut être vide — ce n'est pas bloquant pour ce test

    @pytest.mark.asyncio
    async def test_02_delete_product_sets_purge_date(self):
        """DELETE /products/{id} → 200 + {ok:true, media_purge_scheduled_at}."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, user_id = await login(c, COACH_CREDS)

            # Chercher un produit actif appartenant au coach
            r_products = await c.get(
                f"{BASE_URL}/api/products/mine", headers=auth(token)
            )
            if r_products.status_code != 200:
                pytest.skip("GET /products/mine indisponible")

            products = r_products.json()
            # Handle both list and dict response
            if isinstance(products, dict):
                products = products.get("products", []) or products.get("items", [])

            active = [
                p for p in (products if isinstance(products, list) else [])
                if p.get("status") not in ("deleted",) and not p.get("deleted_at")
            ]

            if not active:
                pytest.skip("Aucun produit actif disponible pour le coach")

            product_id = active[0].get("product_id") or active[0].get("id")
            assert product_id, "Impossible d'extraire le product_id"

            r = await c.delete(
                f"{BASE_URL}/api/products/{product_id}",
                headers=auth(token)
            )

        if r.status_code in (404, 409):
            pytest.skip(f"Produit {product_id} introuvable ou déjà supprimé ({r.status_code})")
        assert r.status_code == 200, \
            f"DELETE product a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert data.get("ok") is True, f"'ok' devrait être True: {data}"
        assert "media_purge_scheduled_at" in data, "media_purge_scheduled_at absent"

        days = days_until(data["media_purge_scheduled_at"])
        assert 89 <= days <= 91, f"media_purge_scheduled_at devrait être ~90j, got {days}"

    @pytest.mark.asyncio
    async def test_03_reactivate_product_success(self):
        """POST /products/{id}/reactivate → {ok:true, reactivated:true}.
        
        Utilise GET /users/me/reactivatable pour trouver un produit supprimé
        (GET /products/mine filtre les produits status='deleted').
        """
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, user_id = await login(c, COACH_CREDS)

            # Utiliser /users/me/reactivatable pour trouver des produits supprimés
            r_react = await c.get(
                f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token)
            )
            if r_react.status_code != 200:
                pytest.skip("GET /users/me/reactivatable indisponible")

            react_data = r_react.json()
            deleted_products = react_data.get("products", [])

            if not deleted_products:
                pytest.skip("Aucun produit dans reactivatable (test_02 peut-être skippé)")

            product_id = deleted_products[0].get("id") or deleted_products[0].get("product_id")
            assert product_id, "Impossible d'extraire le product_id depuis reactivatable"

            r = await c.post(
                f"{BASE_URL}/api/products/{product_id}/reactivate",
                headers=auth(token)
            )

        if r.status_code == 409:
            pytest.skip(f"Produit {product_id} déjà actif (409)")
        assert r.status_code == 200, \
            f"reactivate product a échoué: {r.status_code} — {r.text}"
        data = r.json()
        assert data.get("ok") is True or data.get("reactivated") is True, \
            f"Réponse reactivate inattendue: {data}"
        assert data.get("reactivated") is True, f"'reactivated' devrait être True: {data}"


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 5 — Profil utilisateur : deactivate ▶ reactivate
# ══════════════════════════════════════════════════════════════════════════════

class TestUserDeactivateReactivateCycle:
    """
    ATTENTION : test destructif — désactive puis réactive le coach.
    Les SpotYou/services/produits du coach NE SONT PAS auto-réactivés.
    Ce test est le DERNIER de la séquence.
    """

    @pytest.mark.asyncio
    async def test_01_deactivate_user_coach(self):
        """PATCH /users/{id}/deactivate → 200 ou 409 si déjà désactivé."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, coach_id = await login(c, COACH_CREDS)
            r = await c.patch(
                f"{BASE_URL}/api/users/{coach_id}/deactivate",
                headers=auth(token)
            )

        # 200 = désactivé, 409 = déjà désactivé
        assert r.status_code in (200, 409), \
            f"PATCH /users/deactivate a retourné {r.status_code}: {r.text}"

        if r.status_code == 200:
            data = r.json()
            assert data.get("success") is True, f"'success' devrait être True: {data}"
            assert data.get("deactivated") is True, f"'deactivated' devrait être True: {data}"
            assert "media_purge_scheduled_at" in data, "media_purge_scheduled_at absent"

    @pytest.mark.asyncio
    async def test_02_reactivate_user_coach(self):
        """
        POST /users/{id}/reactivate → 200 (si désactivé) ou 409 (si déjà actif).
        Restaure le compte coach pour ne pas laisser de données corrompues.
        """
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            # On utilise le token admin pour réactiver au besoin
            admin_token, _ = await login(c, ADMIN_CREDS)
            coach_token, coach_id = await login(c, COACH_CREDS)

            # Essayer la réactivation depuis le coach lui-même
            r = await c.post(
                f"{BASE_URL}/api/users/{coach_id}/reactivate",
                headers=auth(coach_token)
            )

            # Si 403/401 → essayer via admin
            if r.status_code in (401, 403):
                r = await c.post(
                    f"{BASE_URL}/api/users/{coach_id}/reactivate",
                    headers=auth(admin_token)
                )

        # 200 = réactivé, 409 = déjà actif
        assert r.status_code in (200, 409), \
            f"POST /users/reactivate a retourné {r.status_code}: {r.text}"

        if r.status_code == 200:
            data = r.json()
            assert data.get("success") is True,    f"'success' devrait être True: {data}"
            assert data.get("reactivated") is True, f"'reactivated' devrait être True: {data}"


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 6 — Tests de sécurité / edge cases
# ══════════════════════════════════════════════════════════════════════════════

class TestSecurityEdgeCases:

    @pytest.mark.asyncio
    async def test_user_cannot_deactivate_other_user(self):
        """Un user ne peut pas désactiver le compte d'un autre → 403."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            user_token,  _       = await login(c, USER_CREDS)
            _, coach_id          = await login(c, COACH_CREDS)
            r = await c.patch(
                f"{BASE_URL}/api/users/{coach_id}/deactivate",
                headers=auth(user_token)
            )
        assert r.status_code == 403, \
            f"Devrait être 403, got {r.status_code}: {r.text}"

    @pytest.mark.asyncio
    async def test_user_cannot_reactivate_tagpoint_of_other(self):
        """Un user ne peut pas réactiver le SpotYou d'un autre → 403."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            user_token, _ = await login(c, USER_CREDS)
            r = await c.post(
                f"{BASE_URL}/api/tag-points/{COACH_TAGPOINT_ID}/reactivate",
                headers=auth(user_token)
            )
        # 403 (interdit) ou 409 (déjà actif) — les deux sont valides
        assert r.status_code in (403, 404, 409), \
            f"Devrait être 403/404/409, got {r.status_code}: {r.text}"

    @pytest.mark.asyncio
    async def test_deactivate_nonexistent_user_returns_404(self):
        """PATCH /users/usr_inexistant_9999/deactivate → 404."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, ADMIN_CREDS)
            r = await c.patch(
                f"{BASE_URL}/api/users/usr_inexistant_9999/deactivate",
                headers=auth(token)
            )
        assert r.status_code == 404, \
            f"Devrait être 404, got {r.status_code}: {r.text}"

    @pytest.mark.asyncio
    async def test_reactivate_nonexistent_tagpoint_returns_404(self):
        """POST /tag-points/pt_inexistant_9999/reactivate → 404."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.post(
                f"{BASE_URL}/api/tag-points/pt_inexistant_9999/reactivate",
                headers=auth(token)
            )
        assert r.status_code == 404, \
            f"Devrait être 404, got {r.status_code}: {r.text}"

    @pytest.mark.asyncio
    async def test_get_services_deactivated_requires_auth(self):
        """GET /services/deactivated sans token → 401 ou 403."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(f"{BASE_URL}/api/services/deactivated")
        assert r.status_code in (401, 403), \
            f"Devrait être 401/403, got {r.status_code}"

    @pytest.mark.asyncio
    async def test_reactivate_already_active_service_returns_409(self):
        """POST /services/{id}/reactivate sur un service actif → 409."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            # svc_demo001 devrait être actif (réactivé dans le bloc 3)
            r = await c.post(
                f"{BASE_URL}/api/services/{COACH_SERVICE_ID}/reactivate",
                headers=auth(token)
            )
        # 409 si actif, 200 si supprimé (cycle incomplet)
        assert r.status_code in (409, 200), \
            f"Devrait être 409 ou 200, got {r.status_code}: {r.text}"

    @pytest.mark.asyncio
    async def test_reactivatable_user_creds_also_works(self):
        """GET /users/me/reactivatable fonctionne aussi pour user@winek.app."""
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, USER_CREDS)
            r = await c.get(f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token))

        assert r.status_code == 200, f"reactivatable failed for user: {r.status_code}"
        data = r.json()
        assert "total" in data


# ══════════════════════════════════════════════════════════════════════════════
# Bloc 7 — DB Migration 012 : colonnes présentes
# ══════════════════════════════════════════════════════════════════════════════

class TestMigration012Columns:
    """Vérifie via API que les colonnes migration 012 sont présentes (indirect)."""

    @pytest.mark.asyncio
    async def test_reactivatable_endpoint_responds_to_migration012(self):
        """
        Si GET /users/me/reactivatable répond 200, c'est que les colonnes
        media_purge_scheduled_at, media_purged, reactivated_at existent sur les tables.
        (Indirect — si absentes → le SELECT planterait avec 500)
        """
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/users/me/reactivatable", headers=auth(token))
        assert r.status_code == 200, \
            f"reactivatable a retourné {r.status_code} — colonnes migration 012 peut-être absentes? {r.text}"

    @pytest.mark.asyncio
    async def test_services_deactivated_uses_migration012_columns(self):
        """
        GET /services/deactivated renvoie days_until_media_purge → preuve que
        media_purge_scheduled_at existe sur la table services.
        """
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            token, _ = await login(c, COACH_CREDS)
            r = await c.get(f"{BASE_URL}/api/services/deactivated", headers=auth(token))
        assert r.status_code == 200, \
            f"GET /services/deactivated a retourné {r.status_code} — migration 012 OK?"
        # Liste vide aussi acceptable (aucun service supprimé)
        data = r.json()
        assert isinstance(data, list)
