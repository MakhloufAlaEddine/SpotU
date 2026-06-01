#!/usr/bin/env bash
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

require_deploy_config

SERVICE="${HETZNER_COMPOSE_SERVICE:-spotu-api}"
info "Redémarrage backend ($SERVICE)…"
remote_compose restart "$SERVICE"
ok "Backend redémarré."
