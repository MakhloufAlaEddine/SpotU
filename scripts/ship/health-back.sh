#!/usr/bin/env bash
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

if [[ ! -f "$DEPLOY_ENV_FILE" ]]; then
  die "Fichier absent : $DEPLOY_ENV_FILE — copie scripts/ship/deploy.env.example vers scripts/ship/deploy.env"
fi
load_deploy_env
require_cmd curl

URL="$(backend_readiness_url)"
info "Health check : $URL"

if curl -fsS --max-time 10 "$URL"; then
  echo
  ok "Backend prêt (readiness OK)."
else
  echo
  die "Backend indisponible : $URL"
fi
