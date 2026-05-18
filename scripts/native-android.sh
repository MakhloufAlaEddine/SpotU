#!/usr/bin/env bash
# Build / install natif Android uniquement (sans API).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/android-env.sh"
bash "$ROOT/scripts/require-android-device.sh"
bash "$ROOT/scripts/ensure-dev-env.sh"
cd "$ROOT/frontend"
exec npx expo run:android
