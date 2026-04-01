#!/usr/bin/env bash
# =============================================================================
# reset_test_db.sh — Recrée la base de test locale winek_test from scratch
#
# Usage :
#   bash /app/backend/scripts/reset_test_db.sh            # reset complet
#   bash /app/backend/scripts/reset_test_db.sh --no-seed  # reset sans seed
#
# Ce script :
#   1. Supprime et recrée winek_test
#   2. Installe les extensions PostgreSQL (PostGIS, uuid-ossp, pgcrypto)
#   3. Applique toutes les migrations SQL
#   4. Seed minimal (users, tags, domaines) — désactivable avec --no-seed
# =============================================================================
set -euo pipefail

DB_NAME="winek_test"
DB_USER="winek_test"
DB_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test"
SEED="${1:-}"

echo ""
echo "====================================================="
echo "  RESET BASE DE TEST : $DB_NAME"
echo "====================================================="
echo ""

# ── 1. Drop & recreate ─────────────────────────────────────────────────────
echo "[1/4] Drop + Create database..."
sudo -u postgres psql -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true
sudo -u postgres psql -q -c "DROP DATABASE IF EXISTS $DB_NAME;"
sudo -u postgres psql -q -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
echo "      ✅ winek_test recréée"

# ── 2. Extensions (superuser requis pour PostGIS) ──────────────────────────
echo "[2/4] Extensions PostgreSQL..."
sudo -u postgres psql -q -d "$DB_NAME" -c "
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  GRANT ALL ON SCHEMA public TO $DB_USER;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
"
echo "      ✅ Extensions installées"

# ── 3. Migrations ──────────────────────────────────────────────────────────
echo "[3/4] Migrations SQL..."
cd /app/backend
DATABASE_URL="$DB_URL" python migrations/run_migrations.py
echo "      ✅ Migrations appliquées"

# ── 4. Seed minimal ────────────────────────────────────────────────────────
# Charge toutes les variables requises depuis .env.test (JWT_SECRET, STRIPE_API_KEY, etc.)
ENV_TEST_FILE="$(dirname "$0")/../.env.test"
if [ -f "$ENV_TEST_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_TEST_FILE"
  set +a
fi

if [ "$SEED" != "--no-seed" ]; then
  echo "[4/4] Seed de données de test..."
  DATABASE_URL="$DB_URL" python seed.py
  echo "      ✅ Seed terminé"
else
  echo "[4/4] Seed ignoré (--no-seed)"
fi

echo ""
echo "====================================================="
echo "  ✅  $DB_NAME est prête pour les tests"
echo "  URL : $DB_URL"
echo "  Lancer les tests : bash /app/backend/scripts/run_tests.sh"
echo "====================================================="
echo ""
