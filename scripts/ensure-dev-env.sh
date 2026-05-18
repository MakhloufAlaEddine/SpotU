#!/usr/bin/env bash
# Prépare le venv Python et les dépendances backend (idempotent).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash "$(dirname "$0")/free-api-port.sh"

pick_python() {
  for c in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12 python3; do
    if command -v "$c" &>/dev/null; then
      if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}

PY="$(pick_python || true)"
if [[ -z "${PY:-}" ]]; then
  echo "SpotU: Python 3.10+ introuvable. Installe par ex.: brew install python@3.12" >&2
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "SpotU: création du venv (.venv) avec ${PY}…"
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
echo "SpotU: installation / mise à jour des dépendances backend…"
pip install -q -r backend/requirements.txt

if [[ ! -d frontend/node_modules ]]; then
  echo "SpotU: installation des dépendances frontend…"
  if command -v yarn &>/dev/null; then
    (cd frontend && yarn install)
  else
    (cd frontend && npm install)
  fi
fi

echo "SpotU: environnement prêt."
