#!/usr/bin/env bash
# Backend + frontend OTA (sans rebuild natif).
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

info "=== Déploiement complet (backend + frontend OTA) ==="
bash "$SHIP_DIR/git-sync.sh"
SHIP_SKIP_GIT=1 bash "$SHIP_DIR/ship-back.sh"
echo
SHIP_SKIP_GIT=1 bash "$SHIP_DIR/ship-front.sh"

ok "Déploiement complet terminé."
print_ota_instructions
