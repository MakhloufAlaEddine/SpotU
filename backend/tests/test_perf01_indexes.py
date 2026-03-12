"""
Tests PERF-01 — Index DB SpotU
================================
Vérifie que :
  1. Les 12 nouveaux index existent bien dans pg_indexes
  2. Le planificateur utilise un Index Scan (pas de Seq Scan évitable)
     sur les requêtes critiques, quand enable_seqscan = OFF

Usage :
    cd /app/backend
    python -m pytest tests/test_perf01_indexes.py -v
"""
import os
import asyncio
import asyncpg
import pytest

DB_URL = os.environ.get("DATABASE_URL", "postgresql://winek:winek2024@127.0.0.1/winek_db")

# ─── Connexion helper ─────────────────────────────────────────────────────────

async def _conn():
    return await asyncpg.connect(DB_URL)


# ─── Index attendus ──────────────────────────────────────────────────────────

EXPECTED_INDEXES = [
    ("idx_bookings_user_id",              "bookings"),
    ("idx_bookings_coach_id",             "bookings"),
    ("idx_bookings_service_id",           "bookings"),
    ("idx_bookings_status",               "bookings"),
    ("idx_reviews_reviewee_id",           "reviews"),
    ("idx_reviews_reviewer_id",           "reviews"),
    ("idx_service_slots_service_id",      "service_slots"),
    ("idx_service_packages_service_id",   "service_packages"),
    ("idx_services_coach_id",             "services"),
    ("idx_services_active_created",       "services"),
    ("idx_conversations_created_by",      "conversations"),
]


# ═══════════════════════════════════════════════════════════════════════════════
# [PERF-01-A] Existence des index dans pg_indexes
# ═══════════════════════════════════════════════════════════════════════════════

class TestPERF01_IndexExistence:

    @pytest.mark.parametrize("idx_name,table_name", EXPECTED_INDEXES)
    def test_index_exists(self, idx_name: str, table_name: str):
        """Vérifie que l'index {idx_name} existe sur la table {table_name}."""
        async def run():
            conn = await _conn()
            try:
                row = await conn.fetchrow(
                    """
                    SELECT 1 FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND indexname  = $1
                      AND tablename  = $2
                    """,
                    idx_name, table_name,
                )
                return row is not None
            finally:
                await conn.close()

        exists = asyncio.run(run())
        assert exists, (
            f"FAIL: index '{idx_name}' absent sur la table '{table_name}'. "
            f"Vérifier la migration PERF-01 dans database.py"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# [PERF-01-B] Index Scan confirmé (enable_seqscan = OFF)
# ═══════════════════════════════════════════════════════════════════════════════

async def _explain_plan(sql: str) -> str:
    """Retourne le plan EXPLAIN (FORMAT TEXT) d'une requête."""
    conn = await _conn()
    try:
        await conn.execute("SET enable_seqscan = OFF")
        rows = await conn.fetch(f"EXPLAIN (ANALYZE, FORMAT TEXT) {sql}")
        return "\n".join(r[0] for r in rows)
    finally:
        await conn.close()


class TestPERF01_IndexScans:

    def test_services_par_coach_utilise_idx_coach_id(self):
        """GET /api/services?coach_id=... → Index Scan sur idx_services_coach_id."""
        plan = asyncio.run(_explain_plan(
            "SELECT service_id, title, coach_id, active, created_at "
            "FROM services "
            "WHERE coach_id = 'user_coach001' AND active = TRUE "
            "ORDER BY created_at DESC"
        ))
        assert "Index Scan" in plan, (
            f"Attendu Index Scan sur services(coach_id), plan:\n{plan}"
        )
        assert "idx_services_coach_id" in plan or "idx_services_active_created" in plan, (
            f"Aucun index PERF-01 utilisé pour services(coach_id):\n{plan}"
        )

    def test_bookings_par_user_utilise_idx_user_id(self):
        """GET /api/bookings?user_id=... → Index Scan sur idx_bookings_user_id."""
        plan = asyncio.run(_explain_plan(
            "SELECT booking_id, user_id, coach_id, service_id, status, created_at "
            "FROM bookings "
            "WHERE user_id = 'user_demo001' "
            "ORDER BY created_at DESC"
        ))
        assert "Index Scan" in plan, (
            f"Attendu Index Scan sur bookings(user_id), plan:\n{plan}"
        )
        assert "idx_bookings_user_id" in plan, (
            f"idx_bookings_user_id non utilisé:\n{plan}"
        )

    def test_service_slots_par_service_utilise_idx(self):
        """GET /api/services/{id}/slots → Index Scan sur idx_service_slots_service_id."""
        plan = asyncio.run(_explain_plan(
            "SELECT slot_id, service_id, start_time, end_time "
            "FROM service_slots "
            "WHERE service_id = 'svc_demo001' "
            "ORDER BY start_time"
        ))
        assert "Index Scan" in plan, (
            f"Attendu Index Scan sur service_slots(service_id), plan:\n{plan}"
        )
        assert "idx_service_slots_service_id" in plan, (
            f"idx_service_slots_service_id non utilisé:\n{plan}"
        )

    def test_bookings_par_coach_utilise_idx_coach_id(self):
        """GET /api/bookings?coach_id=... → Index Scan sur idx_bookings_coach_id."""
        plan = asyncio.run(_explain_plan(
            "SELECT booking_id, coach_id, status "
            "FROM bookings "
            "WHERE coach_id = 'user_coach001'"
        ))
        assert "Index Scan" in plan, (
            f"Attendu Index Scan sur bookings(coach_id), plan:\n{plan}"
        )
        assert "idx_bookings_coach_id" in plan, (
            f"idx_bookings_coach_id non utilisé:\n{plan}"
        )



# ═══════════════════════════════════════════════════════════════════════════════
# [PERF-01-C] Vérification statique database.py
# ═══════════════════════════════════════════════════════════════════════════════

class TestPERF01_StaticAnalysis:

    @classmethod
    def _src(cls) -> str:
        with open("/app/backend/database.py", encoding="utf-8") as f:
            return f.read()

    def test_migration_idempotente_if_not_exists(self):
        """Toutes les créations d'index PERF-01 utilisent IF NOT EXISTS."""
        src = self._src()
        for idx_name, _ in EXPECTED_INDEXES:
            assert f"CREATE INDEX IF NOT EXISTS {idx_name}" in src, (
                f"FAIL: 'CREATE INDEX IF NOT EXISTS {idx_name}' absent de database.py"
            )

    def test_annotation_perf01_presente(self):
        """database.py doit contenir le commentaire PERF-01."""
        assert "PERF-01" in self._src(), (
            "FAIL: commentaire PERF-01 absent de database.py"
        )
