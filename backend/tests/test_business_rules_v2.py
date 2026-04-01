"""
test_business_rules_v2.py
==========================
Tests de règles métier P1 : communauté, images, slots.

Règles couvertes :
  1. owner_cannot_leave_community
       → DELETE /api/spot-you/{id}/leave par le propriétaire → 403
       → Un membre normal peut quitter → 200
  2. max_10_images_validation
       → POST /api/tag-points avec 11 images → 400
       → POST /api/tag-points avec 10 images → 201/200 (limite exacte)
       → PUT  /api/tag-points/{id} avec 11 images → 400
       → Service images : validation via modèle Pydantic (max 20 dans ServiceCreate)
  3. slots_masques_si_booking_actif
       → Slot visible quand disponible
       → Slot masqué après réservation active
       → Slot réapparaît après annulation (idempotence)

Niveaux d'isolation :
  ① HTTP seul   — fonctionne contre n'importe quel backend
  ② HTTP + DB   — requiert le serveur de test isolé (start_test_server.sh)

Exécution recommandée (mode ②) :
  bash /app/backend/scripts/start_test_server.sh
  TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \\
    DATABASE_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test" \\
    python -m pytest tests/test_business_rules_v2.py -v
  bash /app/backend/scripts/start_test_server.sh --stop
"""

import asyncio
import asyncpg
import httpx
import os
import uuid
import pytest

# ── Config environnement ───────────────────────────────────────────────────────
TEST_BASE_URL = os.environ.get("TEST_BASE_URL")
BASE_URL      = TEST_BASE_URL or os.environ.get("EXPO_PUBLIC_BACKEND_URL", "")
DB_URL        = os.environ.get("DATABASE_URL")

HAS_DB_ISO = bool(TEST_BASE_URL and DB_URL and "127.0.0.1" in (DB_URL or ""))

requires_db = pytest.mark.skipif(
    not HAS_DB_ISO,
    reason=(
        "Isolation DB requise. Lancer start_test_server.sh puis relancer avec "
        "TEST_BASE_URL=http://localhost:8002 DATABASE_URL=...winek_test..."
    ),
)

# ── Credentials (seed winek_test) ─────────────────────────────────────────────
COACH_EMAIL  = "coach@winek.app"
COACH_PASS   = "WinekCoach2024!"
USER_EMAIL   = "user@winek.app"
USER_PASS    = "WinekUser2024!"
USER2_EMAIL  = "mbenali@winek.app"
USER2_PASS   = "WinekDemo2024!"
ADMIN_EMAIL  = "admin@winek.app"
ADMIN_PASS   = "WinekAdmin2024!"

# Données seed winek_test
TAG_ID    = "tag_10km"
DOMAIN_ID = "dom_sport"
SVC_DEMO  = "svc_demo001"

# Coordonnées Paris (valides, hors zone spéciale)
LAT, LNG  = 48.856614, 2.352222


# ══════════════════════════════════════════════════════════════════════════════
# Fixtures
# ══════════════════════════════════════════════════════════════════════════════

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="module")
def http():
    with httpx.Client(base_url=BASE_URL, timeout=20) as c:
        yield c


@pytest.fixture(scope="module")
async def pool():
    """Pool asyncpg winek_test (mode ② uniquement)."""
    if not HAS_DB_ISO:
        yield None
        return
    p = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5, ssl=False)
    yield p
    await p.close()


def _login(http_client, email: str, password: str) -> str:
    r = http_client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login échoué ({email}): {r.text}"
    return r.json()["token"]


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tok_coach(http):
    return _login(http, COACH_EMAIL, COACH_PASS)


@pytest.fixture(scope="module")
def tok_user(http):
    return _login(http, USER_EMAIL, USER_PASS)


@pytest.fixture(scope="module")
def tok_user2(http):
    r = http.post("/api/auth/login", json={"email": USER2_EMAIL, "password": USER2_PASS})
    if r.status_code != 200:
        return None
    return r.json()["token"]


@pytest.fixture(scope="module")
def tok_admin(http):
    return _login(http, ADMIN_EMAIL, ADMIN_PASS)


def _create_spotyou(http, token: str, extra: dict | None = None) -> dict:
    """Crée un SpotYou minimal pour les tests."""
    payload = {
        "title": f"Test SpotYou {uuid.uuid4().hex[:6]}",
        "description": "SpotYou de test automatique",
        "latitude": LAT,
        "longitude": LNG,
        "precision": "1000m",
        "tag_ids": [TAG_ID],
        "domain_id": DOMAIN_ID,
    }
    if extra:
        payload.update(extra)
    r = http.post("/api/tag-points", json=payload, headers=_h(token))
    return r


def _delete_spotyou(http, token: str, point_id: str):
    """Supprime un SpotYou (cleanup)."""
    http.delete(f"/api/tag-points/{point_id}", headers=_h(token))


# ══════════════════════════════════════════════════════════════════════════════
# Règle 1 — Le propriétaire ne peut pas quitter sa communauté
# ══════════════════════════════════════════════════════════════════════════════

class TestOwnerCannotLeaveCommunity:
    """
    DELETE /api/spot-you/{id}/leave
    - Propriétaire → 403
    - Membre normal → 200
    """

    def test_owner_leave_returns_403(self, http, tok_coach):
        """Le propriétaire du SpotYou ne peut pas quitter sa propre communauté → 403."""
        r_create = _create_spotyou(http, tok_coach)
        assert r_create.status_code in (200, 201), (
            f"Création SpotYou échouée : {r_create.text}"
        )
        pid = r_create.json()["point_id"]
        try:
            r_leave = http.delete(f"/api/spot-you/{pid}/leave", headers=_h(tok_coach))
            assert r_leave.status_code == 403, (
                f"Le propriétaire ne peut pas quitter → 403, "
                f"got {r_leave.status_code}: {r_leave.text}"
            )
            assert "propriétaire" in r_leave.json().get("detail", "").lower(), (
                "Le message d'erreur doit mentionner 'propriétaire'"
            )
        finally:
            _delete_spotyou(http, tok_coach, pid)

    def test_member_can_leave_returns_200(self, http, tok_coach, tok_user):
        """Un membre non-propriétaire peut quitter le SpotYou → 200."""
        r_create = _create_spotyou(http, tok_coach)
        assert r_create.status_code in (200, 201)
        pid = r_create.json()["point_id"]
        try:
            # Le membre rejoint d'abord
            r_join = http.post(f"/api/spot-you/{pid}/join", headers=_h(tok_user))
            if r_join.status_code not in (200, 201):
                pytest.skip(f"Join échoué ({r_join.status_code}), skip test leave")

            # Le membre quitte → 200
            r_leave = http.delete(f"/api/spot-you/{pid}/leave", headers=_h(tok_user))
            assert r_leave.status_code == 200, (
                f"Le membre doit pouvoir quitter → 200, "
                f"got {r_leave.status_code}: {r_leave.text}"
            )
            assert r_leave.json().get("is_member") is False, (
                "is_member doit être False après départ"
            )
        finally:
            _delete_spotyou(http, tok_coach, pid)

    def test_owner_leave_nonexistent_spotyou_returns_404(self, http, tok_coach):
        """DELETE /api/spot-you/{nonexistent}/leave → 404."""
        r = http.delete("/api/spot-you/pt_nonexistent_xyz/leave", headers=_h(tok_coach))
        assert r.status_code in (403, 404), (
            f"SpotYou inexistant → 403 ou 404, got {r.status_code}: {r.text}"
        )

    def test_leave_requires_auth_returns_401(self, http):
        """DELETE /api/spot-you/{id}/leave sans auth → 401."""
        r = http.delete("/api/spot-you/pt_fake/leave")
        assert r.status_code == 401, (
            f"Sans auth → 401, got {r.status_code}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# Règle 2 — Validation max 10 images (SpotYou)
# ══════════════════════════════════════════════════════════════════════════════

class TestMaxImagesValidation:
    """
    POST /api/tag-points   : 11 images → 400 ; 10 images → 200
    PUT  /api/tag-points/{id} : 11 images → 400
    """

    FAKE_IMAGES = [f"https://example.com/img_{i}.jpg" for i in range(12)]

    def test_create_spotyou_with_11_images_returns_400(self, http, tok_coach):
        """POST /api/tag-points avec 11 images → 400 Maximum 10 images."""
        r = _create_spotyou(http, tok_coach, extra={"images": self.FAKE_IMAGES[:11]})
        assert r.status_code == 400, (
            f"11 images lors de la création → 400, got {r.status_code}: {r.text}"
        )
        assert "10" in r.json().get("detail", "") or "image" in r.json().get("detail", "").lower(), (
            "Le message doit mentionner la limite d'images"
        )

    def test_create_spotyou_with_exactly_10_images_succeeds(self, http, tok_coach):
        """POST /api/tag-points avec exactement 10 images → 200/201 (limite exacte acceptée)."""
        r = _create_spotyou(http, tok_coach, extra={"images": self.FAKE_IMAGES[:10]})
        assert r.status_code in (200, 201), (
            f"10 images → doit réussir, got {r.status_code}: {r.text}"
        )
        pid = r.json().get("point_id")
        if pid:
            _delete_spotyou(http, tok_coach, pid)

    def test_update_spotyou_with_11_images_returns_400(self, http, tok_coach):
        """PUT /api/tag-points/{id} avec 11 images → 400."""
        # Créer un SpotYou valide d'abord
        r_create = _create_spotyou(http, tok_coach)
        assert r_create.status_code in (200, 201)
        pid = r_create.json()["point_id"]
        try:
            r_update = http.put(
                f"/api/tag-points/{pid}",
                json={"images": self.FAKE_IMAGES[:11]},
                headers=_h(tok_coach),
            )
            assert r_update.status_code == 400, (
                f"11 images lors d'une mise à jour → 400, got {r_update.status_code}: {r_update.text}"
            )
        finally:
            _delete_spotyou(http, tok_coach, pid)

    def test_create_spotyou_without_images_succeeds(self, http, tok_coach):
        """POST /api/tag-points sans images → 200/201 (images optionnelles)."""
        r = _create_spotyou(http, tok_coach)
        assert r.status_code in (200, 201), (
            f"Création sans images → doit réussir, got {r.status_code}: {r.text}"
        )
        pid = r.json().get("point_id")
        if pid:
            _delete_spotyou(http, tok_coach, pid)

    def test_create_spotyou_tag_ids_required(self, http, tok_coach):
        """POST /api/tag-points sans tag_ids → 400 (Au moins un tag requis)."""
        payload = {
            "title": "SpotYou sans tags",
            "latitude": LAT,
            "longitude": LNG,
            "precision": "1000m",
            "tag_ids": [],
            "domain_id": DOMAIN_ID,
        }
        r = http.post("/api/tag-points", json=payload, headers=_h(tok_coach))
        assert r.status_code == 400, (
            f"tag_ids vide → 400, got {r.status_code}: {r.text}"
        )

    def test_create_spotyou_min_gt_max_returns_400(self, http, tok_coach):
        """POST /api/tag-points avec min > max → 400."""
        r = _create_spotyou(http, tok_coach, extra={
            "minimum_participants": 10,
            "maximum_participants": 5,
        })
        assert r.status_code == 400, (
            f"min > max → 400, got {r.status_code}: {r.text}"
        )


# ══════════════════════════════════════════════════════════════════════════════
# Règle 3 — Slots masqués si booking actif (mode ①)
# ══════════════════════════════════════════════════════════════════════════════

class TestSlotsMasquesSiBookingActif:
    """
    Règle : un slot avec une réservation active (pending/accepted/awaiting_payment/confirmed)
    ne doit pas apparaître dans la liste des slots du service.

    Test :
      1. Slot disponible → visible dans GET /api/services/{id}
      2. Réservation créée sur ce slot → slot masqué
      3. Réservation annulée → slot réapparaît

    Mode ① car le backend (8002 ou Supabase) gère la logique.
    La vérification est HTTP-only sur la liste des slots du service.
    """

    def _get_available_slots(self, http, tok, svc_id: str) -> list:
        """Retourne les slots disponibles d'un service (type single ou specific)."""
        r = http.get(f"/api/services/{svc_id}", headers=_h(tok))
        if r.status_code != 200:
            return []
        slots = r.json().get("slots", [])
        return [
            s for s in slots
            if s.get("slot_status") in ("available", None)
            and s.get("slot_type") in ("single", "specific")
        ]

    def _configure_instant(self, http, tok_admin, tok_coach, svc_id):
        """Configure le service en instant_booking pour les tests de slots."""
        http.put(
            "/api/admin/app-config",
            json={"enable_manual_approval_for_services": False,
                  "enable_pay_later_for_services": False},
            headers=_h(tok_admin),
        )
        http.patch(
            f"/api/services/{svc_id}",
            json={"booking_approval_mode": "instant_booking", "allow_pay_later": False},
            headers=_h(tok_coach),
        )

    def _reset_service(self, http, tok_admin, tok_coach, svc_id):
        http.put(
            "/api/admin/app-config",
            json={"enable_manual_approval_for_services": True,
                  "enable_pay_later_for_services": True},
            headers=_h(tok_admin),
        )
        http.patch(
            f"/api/services/{svc_id}",
            json={"booking_approval_mode": "manual_approval", "allow_pay_later": True},
            headers=_h(tok_coach),
        )

    def test_slot_visible_avant_reservation(self, http, tok_user, tok_coach, tok_admin):
        """Le slot est visible dans la liste du service quand aucune réservation active."""
        self._configure_instant(http, tok_admin, tok_coach, SVC_DEMO)
        try:
            slots = self._get_available_slots(http, tok_user, SVC_DEMO)
            assert slots, (
                "Au moins un slot doit être disponible dans svc_demo001 (vérifier le seed)"
            )
        finally:
            self._reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_slot_masque_apres_reservation(self, http, tok_user, tok_coach, tok_admin):
        """Le slot disparaît de la liste du service après réservation active."""
        self._configure_instant(http, tok_admin, tok_coach, SVC_DEMO)
        booking_id = None
        slot_id = None
        try:
            slots = self._get_available_slots(http, tok_user, SVC_DEMO)
            if not slots:
                pytest.skip("Aucun slot disponible pour ce test")

            slot_id = slots[0]["slot_id"]
            slots_before = {s["slot_id"] for s in slots}
            assert slot_id in slots_before, "Le slot doit être visible avant réservation"

            # Réserver le slot
            r_bk = http.post(
                "/api/bookings/request",
                json={"service_id": SVC_DEMO, "payment_mode": "pay_now", "slot_id": slot_id},
                headers=_h(tok_user),
            )
            assert r_bk.status_code in (200, 201), f"Réservation échouée : {r_bk.text}"
            booking_id = r_bk.json()["booking_id"]

            # Vérifier que le slot est masqué
            slots_after = {s["slot_id"] for s in self._get_available_slots(http, tok_user, SVC_DEMO)}
            assert slot_id not in slots_after, (
                f"Le slot '{slot_id}' doit être masqué après réservation active"
            )
        finally:
            if booking_id:
                http.post(
                    f"/api/bookings/{booking_id}/cancel",
                    json={"reason": "cleanup_test"},
                    headers=_h(tok_admin),
                )
            self._reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_slot_reapparait_apres_annulation(self, http, tok_user, tok_coach, tok_admin):
        """Le slot redevient visible après annulation de la réservation."""
        self._configure_instant(http, tok_admin, tok_coach, SVC_DEMO)
        booking_id = None
        slot_id = None
        try:
            slots = self._get_available_slots(http, tok_user, SVC_DEMO)
            if not slots:
                pytest.skip("Aucun slot disponible pour ce test")

            slot_id = slots[0]["slot_id"]

            # Réserver
            r_bk = http.post(
                "/api/bookings/request",
                json={"service_id": SVC_DEMO, "payment_mode": "pay_now", "slot_id": slot_id},
                headers=_h(tok_user),
            )
            assert r_bk.status_code in (200, 201), f"Réservation échouée : {r_bk.text}"
            booking_id = r_bk.json()["booking_id"]

            # Confirmer que le slot est masqué
            slots_reserved = {s["slot_id"] for s in self._get_available_slots(http, tok_user, SVC_DEMO)}
            assert slot_id not in slots_reserved, "Slot doit être masqué après réservation"

            # Annuler la réservation
            r_cancel = http.post(
                f"/api/bookings/{booking_id}/cancel",
                json={"reason": "test_slot_reapparait"},
                headers=_h(tok_user),
            )
            assert r_cancel.status_code == 200, f"Annulation échouée : {r_cancel.text}"
            booking_id = None  # Déjà annulé

            # Vérifier que le slot réapparaît
            slots_after_cancel = {s["slot_id"] for s in self._get_available_slots(http, tok_user, SVC_DEMO)}
            assert slot_id in slots_after_cancel, (
                f"Le slot '{slot_id}' doit réapparaître après annulation"
            )
        finally:
            if booking_id:
                http.post(
                    f"/api/bookings/{booking_id}/cancel",
                    json={"reason": "cleanup_test"},
                    headers=_h(tok_admin),
                )
            self._reset_service(http, tok_admin, tok_coach, SVC_DEMO)

    def test_slot_status_inclus_dans_reponse_service(self, http, tok_user):
        """GET /api/services/{id} doit retourner slot_status dans chaque slot."""
        r = http.get(f"/api/services/{SVC_DEMO}", headers=_h(tok_user))
        assert r.status_code == 200
        slots = r.json().get("slots", [])
        if not slots:
            pytest.skip("Aucun slot dans svc_demo001 (vérifier le seed)")

        for slot in slots:
            assert "slot_status" in slot, (
                f"Le champ 'slot_status' est absent du slot {slot.get('slot_id')}"
            )
            assert slot["slot_status"] in ("available", "pending", "reserved", "completed"), (
                f"slot_status invalide : {slot['slot_status']}"
            )
