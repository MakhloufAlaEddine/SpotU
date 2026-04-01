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
# Note sur les tests HTTP (API) :
#   Les tests qui appellent EXPO_PUBLIC_BACKEND_URL (le backend en cours)
#   utilisent toujours le backend principal (Supabase).
#   Pour les isoler, lancer d'abord : bash scripts/start_test_server.sh
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
