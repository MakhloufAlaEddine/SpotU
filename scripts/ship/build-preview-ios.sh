#!/usr/bin/env bash
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

require_cmd npx
cd "$FRONTEND_DIR"
info "Build EAS iOS (profile=preview, bundle com.winek.mobile) …"
npx eas build --platform ios --profile preview
print_ios_install_note
