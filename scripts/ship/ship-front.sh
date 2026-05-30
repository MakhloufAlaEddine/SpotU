#!/usr/bin/env bash
# Frontend OTA : git sync + eas update (channel preview).
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

if [[ "${SHIP_SKIP_GIT:-0}" != "1" ]]; then
  bash "$SHIP_DIR/git-sync.sh"
fi

require_cmd npx
[[ -d "$FRONTEND_DIR" ]] || die "Dossier frontend introuvable : $FRONTEND_DIR"

info "Publication EAS Update (channel=${EAS_CHANNEL}) …"
cd "$FRONTEND_DIR"
npx eas update --channel "$EAS_CHANNEL" --message "$EAS_UPDATE_MESSAGE" --non-interactive

ok "EAS Update publié."
print_ota_instructions
