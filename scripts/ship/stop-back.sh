#!/usr/bin/env bash
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

require_deploy_config

info "Arrêt backend…"
remote_compose down
ok "Backend arrêté ($HETZNER_SSH → $HETZNER_APP_DIR)."
