#!/usr/bin/env bash
# Lance API + expo start --android (dev client déjà installé).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/scripts/android-env.sh"
bash "$ROOT/scripts/require-android-device.sh"
bash "$ROOT/scripts/ensure-dev-env.sh"
exec npx concurrently -k -n api,android -c blue,yellow \
  "npm run dev:api" \
  "bash -c 'source \"$ROOT/scripts/android-env.sh\"; cd \"$ROOT/frontend\" && exec npx expo start --android'"
