#!/bin/bash
# ─── Script de lancement des tests E2E SpotU ────────────────────────────────
# Usage:
#   ./run_e2e.sh                  # Tous les tests
#   ./run_e2e.sh test_01_auth     # Un fichier spécifique
#   ./run_e2e.sh -k "test_login"  # Un test spécifique

set -e

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYWRIGHT_BIN="/opt/plugins-venv/bin/playwright"
PYTEST_BIN="/opt/plugins-venv/bin/pytest"
PYTHON_BIN="/opt/plugins-venv/bin/python3"

# Installer les navigateurs si nécessaire
if ! $PLAYWRIGHT_BIN install chromium --dry-run 2>/dev/null; then
  echo "Installation des navigateurs Playwright..."
  $PLAYWRIGHT_BIN install chromium
fi

echo "=== Lancement des tests E2E SpotU ==="
echo "URL: ${EXPO_PUBLIC_BACKEND_URL:-https://tag-modal-rollout.preview.emergentagent.com}"
echo ""

cd "$E2E_DIR"

# Arguments par défaut
ARGS="${@:---x --tb=short -v}"

# Lancer les tests
$PYTEST_BIN \
  --browser chromium \
  --headed=false \
  --base-url "${EXPO_PUBLIC_BACKEND_URL:-https://tag-modal-rollout.preview.emergentagent.com}" \
  $ARGS \
  2>&1 | tee /tmp/e2e_results.txt

echo ""
echo "=== Résultats sauvegardés dans /tmp/e2e_results.txt ==="
