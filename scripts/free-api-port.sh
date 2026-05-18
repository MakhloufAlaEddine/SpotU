#!/usr/bin/env bash
# Libère le port HTTP de l'API (uvicorn) pour le dev local.
# Utilise BACKEND_PORT si défini, sinon 8001. Désactive avec SPOTU_SKIP_FREE_PORT=1.
set -euo pipefail
[[ "${SPOTU_SKIP_FREE_PORT:-}" == "1" ]] && exit 0
PORT="${BACKEND_PORT:-8001}"
command -v lsof &>/dev/null || exit 0
pids="$(lsof -ti ":${PORT}" 2>/dev/null || true)"
if [[ -n "${pids:-}" ]]; then
  echo "SpotU: port ${PORT} déjà utilisé — arrêt du processus (PIDs: $(echo "$pids" | tr '\n' ' '))."
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 0.4
fi
