"""
Tests — Worker de purge différée R2 (Phase 5 soft delete)
Couvre : dry_run, purge réelle, idempotence, fichier absent, erreur R2 partielle,
         protection endpoint admin, colonnes de traçabilité.
"""

import pytest
import httpx
import asyncio
import asyncpg
import os
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock, AsyncMock

BASE_URL = os.environ.get("TEST_BASE_URL", "https://api-slice-preview.preview.emergentagent.com")
DB_URL   = os.environ.get("DATABASE_URL", "")

ADMIN_CREDS = {"email": "admin@winek.app",    "password": "WinekAdmin2024!"}
USER_CREDS  = {"email": "user@winek.app",     "password": "WinekUser2024!"}


# ── Helpers ────────────────────────────────────────────────────────────────────

async def get_token(client: httpx.AsyncClient, creds: dict) -> str:
    r = await client.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200
    d = r.json()
    return d.get("access_token") or d.get("token")


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _insert_pfd_row(conn, file_url: str, scheduled_before_days: int = 0, status: str = "pending") -> str:
    """Insère une ligne de test dans pending_file_deletions."""
    row_id = f"test_{uuid.uuid4().hex[:12]}"
    ts = datetime.now(timezone.utc) - timedelta(days=scheduled_before_days, hours=1)
    await conn.execute(
        """INSERT INTO pending_file_deletions
           (id, file_url, entity_type, entity_id, scheduled_at, status)
           VALUES ($1, $2, 'test', 'test_entity', $3, $4)""",
        row_id, file_url, ts, status
    )
    return row_id


async def _cleanup_pfd_rows(conn, row_ids: list):
    """Nettoie les lignes de test."""
    if row_ids:
        await conn.execute(
            "DELETE FROM pending_file_deletions WHERE id = ANY($1::text[])", row_ids
        )


# ── Phase 2 Migration : Vérification colonnes ─────────────────────────────────

class TestMigration011Columns:

    @pytest.mark.asyncio
    async def test_pfd_has_status_column(self):
        """pending_file_deletions.status doit exister."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        try:
            count = await conn.fetchval(
                """SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_name='pending_file_deletions' AND column_name='status'"""
            )
            assert count == 1, "Colonne status manquante"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_pfd_has_all_tracking_columns(self):
        """pending_file_deletions doit avoir error_message, attempt_count, last_attempt_at."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        try:
            count = await conn.fetchval(
                """SELECT COUNT(*) FROM information_schema.columns
                   WHERE table_schema='public'
                     AND table_name='pending_file_deletions'
                     AND column_name IN ('error_message','attempt_count','last_attempt_at')"""
            )
            assert count == 3, f"Colonnes de traçabilité manquantes (trouvé {count}/3)"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_pfd_status_check_constraint(self):
        """INSERT avec status invalide doit échouer (check constraint)."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        try:
            with pytest.raises(asyncpg.CheckViolationError):
                await conn.execute(
                    "INSERT INTO pending_file_deletions(id,file_url,entity_type,entity_id,status) "
                    "VALUES('test_invalid','http://test','test','test','invalid_status')"
                )
        finally:
            await conn.close()


# ── Endpoint admin protégé ────────────────────────────────────────────────────

class TestPurgeEndpointProtection:

    @pytest.mark.asyncio
    async def test_purge_requires_admin(self):
        """POST /api/admin/purge nécessite le rôle admin → 403 pour user standard."""
        async with httpx.AsyncClient(timeout=30) as client:
            token = await get_token(client, USER_CREDS)
            r = await client.post(
                f"{BASE_URL}/api/admin/purge?dry_run=true",
                headers=auth_headers(token)
            )
            assert r.status_code == 403, f"Devrait être 403, got {r.status_code}"

    @pytest.mark.asyncio
    async def test_purge_requires_auth(self):
        """POST /api/admin/purge sans token → 401 ou 403."""
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{BASE_URL}/api/admin/purge?dry_run=true")
            assert r.status_code in (401, 403), f"Devrait être 401/403, got {r.status_code}"

    @pytest.mark.asyncio
    async def test_purge_status_requires_admin(self):
        """GET /api/admin/purge/status nécessite le rôle admin → 403 pour user standard."""
        async with httpx.AsyncClient(timeout=30) as client:
            token = await get_token(client, USER_CREDS)
            r = await client.get(
                f"{BASE_URL}/api/admin/purge/status",
                headers=auth_headers(token)
            )
            assert r.status_code == 403, f"Devrait être 403, got {r.status_code}"


# ── Dry-run ────────────────────────────────────────────────────────────────────

class TestPurgeDryRun:

    @pytest.mark.asyncio
    async def test_dry_run_default(self):
        """dry_run=true (défaut) → aucune suppression réelle, réponse structurée."""
        async with httpx.AsyncClient(timeout=30) as client:
            token = await get_token(client, ADMIN_CREDS)
            r = await client.post(
                f"{BASE_URL}/api/admin/purge?dry_run=true&retention_days=30",
                headers=auth_headers(token)
            )
            assert r.status_code == 200, f"Erreur: {r.text}"
            data = r.json()
            assert "scanned"   in data
            assert "eligible"  in data
            assert "deleted"   in data
            assert "failed"    in data
            assert "skipped"   in data
            assert "dry_run"   in data
            assert "details"   in data
            assert data["dry_run"] is True
            assert isinstance(data["details"], list)

    @pytest.mark.asyncio
    async def test_dry_run_does_not_modify_db(self):
        """dry_run=true ne doit pas modifier le status des entrées pending."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            # Insérer une ligne éligible (ancienne)
            row_id = await _insert_pfd_row(
                conn,
                "https://example.com/test_dryrun.jpg",
                scheduled_before_days=40
            )
            row_ids.append(row_id)

            # Lancer dry_run via API
            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                r = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=true&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                assert r.status_code == 200

            # Vérifier que le status n'a pas changé
            row = await conn.fetchrow(
                "SELECT status, processed_at FROM pending_file_deletions WHERE id=$1", row_id
            )
            assert row["status"] == "pending", \
                f"Le dry_run a modifié le status: {row['status']}"
            assert row["processed_at"] is None, "processed_at ne doit pas être set en dry_run"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()

    @pytest.mark.asyncio
    async def test_dry_run_eligible_count(self):
        """dry_run identifie correctement les entrées éligibles (>30 jours) vs non-éligibles."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            # Entrée éligible (35 jours)
            old_id = await _insert_pfd_row(
                conn, "https://old.example.com/old.jpg", scheduled_before_days=35
            )
            row_ids.append(old_id)

            # Entrée non éligible (5 jours seulement)
            new_id = await _insert_pfd_row(
                conn, "https://new.example.com/new.jpg", scheduled_before_days=5
            )
            row_ids.append(new_id)

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                r = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=true&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                assert r.status_code == 200
                data = r.json()

            # L'entrée de 35 jours doit être dans les details
            detail_ids = [d.get("id") for d in data.get("details", [])]
            assert old_id in detail_ids, \
                f"L'entrée éligible ({old_id}) n'est pas dans les details"
            assert new_id not in detail_ids, \
                f"L'entrée non éligible ({new_id}) est dans les details"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()


# ── Purge status endpoint ─────────────────────────────────────────────────────

class TestPurgeStatusEndpoint:

    @pytest.mark.asyncio
    async def test_purge_status_structure(self):
        """GET /api/admin/purge/status retourne une structure valide."""
        async with httpx.AsyncClient(timeout=30) as client:
            token = await get_token(client, ADMIN_CREDS)
            r = await client.get(
                f"{BASE_URL}/api/admin/purge/status",
                headers=auth_headers(token)
            )
            assert r.status_code == 200, f"Erreur: {r.text}"
            data = r.json()
            assert "total"        in data
            assert "pending"      in data
            assert "by_status"    in data
            assert isinstance(data["by_status"], list)
            assert isinstance(data["total"], int)
            assert isinstance(data["pending"], int)

    @pytest.mark.asyncio
    async def test_purge_status_counts_pending(self):
        """GET /api/admin/purge/status compte correctement les entrées pending."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            # Insérer 2 entrées pending
            id1 = await _insert_pfd_row(conn, "https://a.example.com/a.jpg")
            id2 = await _insert_pfd_row(conn, "https://b.example.com/b.jpg")
            row_ids.extend([id1, id2])

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                r = await client.get(
                    f"{BASE_URL}/api/admin/purge/status",
                    headers=auth_headers(token)
                )
                data = r.json()

            # pending doit inclure au moins nos 2 lignes
            assert data["pending"] >= 2, \
                f"Le compteur pending ({data['pending']}) devrait inclure nos 2 lignes de test"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()


# ── Purge réelle — idempotence & fichier absent ───────────────────────────────

class TestPurgeReal:

    @pytest.mark.asyncio
    async def test_purge_real_local_file_missing(self):
        """
        Purge d'une URL locale dont le fichier n'existe pas
        → status='deleted' (idempotent, missing_ok=True).
        """
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            # Fichier local inexistant (ne lance pas d'exception grâce à missing_ok)
            row_id = await _insert_pfd_row(
                conn,
                "https://api-slice-preview.preview.emergentagent.com/api/uploads/img_nonexistent_file.jpg",
                scheduled_before_days=35
            )
            row_ids.append(row_id)

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                r = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=false&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                assert r.status_code == 200

            # Vérifier que le status est 'deleted' (idempotent)
            row = await conn.fetchrow(
                "SELECT status, processed_at FROM pending_file_deletions WHERE id=$1", row_id
            )
            assert row["status"] == "deleted", \
                f"Fichier local absent devrait être 'deleted' (idempotent), got: {row['status']}"
            assert row["processed_at"] is not None, "processed_at doit être défini après purge"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()

    @pytest.mark.asyncio
    async def test_purge_idempotent_double_run(self):
        """
        Deux runs consécutifs sur la même entrée.
        Le deuxième run ne doit pas retraiter les entrées déjà 'deleted'.
        """
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            row_id = await _insert_pfd_row(
                conn,
                "https://api-slice-preview.preview.emergentagent.com/api/uploads/img_idempotent.jpg",
                scheduled_before_days=35
            )
            row_ids.append(row_id)

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                # Premier run
                r1 = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=false&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                data1 = r1.json()

                # Deuxième run
                r2 = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=false&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                data2 = r2.json()

            # Vérifier que la deuxième exécution ne compte pas l'entrée déjà traitée
            detail_ids_r2 = [d.get("id") for d in data2.get("details", [])]
            assert row_id not in detail_ids_r2, \
                f"L'entrée {row_id} ne devrait pas être retraitée au 2ème run (déjà 'deleted')"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()

    @pytest.mark.asyncio
    async def test_purge_url_vide_skip(self):
        """Une entrée avec URL vide doit être ignorée (status='skipped') sans erreur."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            row_id = await _insert_pfd_row(
                conn, "",  # URL vide
                scheduled_before_days=40
            )
            row_ids.append(row_id)

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                r = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=false&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                assert r.status_code == 200

            row = await conn.fetchrow(
                "SELECT status FROM pending_file_deletions WHERE id=$1", row_id
            )
            assert row["status"] == "skipped", \
                f"URL vide devrait être 'skipped', got: {row['status']}"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()

    @pytest.mark.asyncio
    async def test_purge_attempt_count_incremented(self):
        """attempt_count doit être incrémenté à chaque tentative de purge."""
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            row_id = await _insert_pfd_row(
                conn,
                "https://api-slice-preview.preview.emergentagent.com/api/uploads/img_attempt_count.jpg",
                scheduled_before_days=35
            )
            row_ids.append(row_id)

            # Vérifier initial
            initial = await conn.fetchrow(
                "SELECT attempt_count FROM pending_file_deletions WHERE id=$1", row_id
            )
            assert initial["attempt_count"] == 0

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                r = await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=false&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )
                assert r.status_code == 200

            # Vérifier après run
            after = await conn.fetchrow(
                "SELECT attempt_count FROM pending_file_deletions WHERE id=$1", row_id
            )
            assert after["attempt_count"] >= 1, \
                f"attempt_count devrait être >= 1 après un run, got: {after['attempt_count']}"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()

    @pytest.mark.asyncio
    async def test_purge_non_eligible_not_touched(self):
        """
        Une entrée planifiée il y a seulement 5 jours ne doit pas être purgée
        quand retention_days=30.
        """
        if not DB_URL:
            pytest.skip("DATABASE_URL non défini")
        conn = await asyncpg.connect(DB_URL)
        row_ids = []
        try:
            row_id = await _insert_pfd_row(
                conn,
                "https://api-slice-preview.preview.emergentagent.com/api/uploads/img_fresh.jpg",
                scheduled_before_days=5  # trop récent
            )
            row_ids.append(row_id)

            async with httpx.AsyncClient(timeout=30) as client:
                token = await get_token(client, ADMIN_CREDS)
                await client.post(
                    f"{BASE_URL}/api/admin/purge?dry_run=false&retention_days=30&batch_size=500",
                    headers=auth_headers(token)
                )

            row = await conn.fetchrow(
                "SELECT status FROM pending_file_deletions WHERE id=$1", row_id
            )
            assert row["status"] == "pending", \
                f"Entrée récente ne doit pas être touchée, got status: {row['status']}"
        finally:
            await _cleanup_pfd_rows(conn, row_ids)
            await conn.close()
