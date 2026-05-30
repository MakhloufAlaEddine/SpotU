#!/usr/bin/env bash
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

require_cmd npx
cd "$FRONTEND_DIR"
info "Build EAS Android (profile=preview) …"
npx eas build --platform android --profile preview
print_apk_reinstall_note
