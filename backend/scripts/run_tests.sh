#!/usr/bin/env bash
# =============================================================================
# run_tests.sh — Lance les tests sur la base de test locale (winek_test)
#
# Usage :
#   bash /app/backend/scripts/run_tests.sh                        # tous les tests
#   bash /app/backend/scripts/run_tests.sh tests/test_no_ddl*    # fichier précis
#   bash /app/backend/scripts/run_tests.sh -k "test_pricing"     # filtre par nom
#   bash /app/backend/scripts/run_tests.sh --reset               # reset DB avant les tests
#
# Variables injectées :
#   TEST_ENV=test            → conftest.py charge .env.test (DATABASE_URL local)
#   DATABASE_URL=...         → pointe sur winek_test (priorité absolue sur .env)
#
# ════════════════════════════════════════════════════════════════════════
# ISOLATION HTTP (IMPORTANT)
# ════════════════════════════════════════════════════════════════════════
# Par défaut (sans TEST_BASE_URL) :
#   • Tests DB (asyncpg direct) → winek_test local ✅
#   • Tests HTTP (requests.post...) → BLOQUÉS (http://localhost:9999)
#     → échouent avec ConnectionError, ne touchent PAS Supabase prod ✅
#
# Pour activer les tests HTTP en isolation complète (mode ②) :
#   bash /app/backend/scripts/start_test_server.sh
#   TEST_ENV=test TEST_BASE_URL=http://localhost:8002 \
#     DATABASE_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test" \
#     python -m pytest tests/ -v
#   bash /app/backend/scripts/start_test_server.sh --stop
# =============================================================================
set -euo pipefail

DB_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test"

# Reset optionnel
if [ "${1:-}" = "--reset" ]; then
  shift
  bash "$(dirname "$0")/reset_test_db.sh"
fi

echo ""
echo "====================================================="
echo "  TESTS — base locale : winek_test"
echo "====================================================="
echo ""

cd /app/backend

export TEST_ENV=test
export DATABASE_URL="$DB_URL"

python -m pytest tests/ \
  --tb=short \
  -q \
  "$@"
