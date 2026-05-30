#!/usr/bin/env bash
# Backend : git sync local + deploy Hetzner (git pull + docker compose build) + readiness.
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

if [[ "${SHIP_SKIP_GIT:-0}" != "1" ]]; then
  bash "$SHIP_DIR/git-sync.sh"
fi

require_cmd ssh
require_cmd curl
[[ -d "$BACKEND_DIR" ]] || die "Dossier backend-java introuvable : $BACKEND_DIR"

load_deploy_env

READINESS_URL="${BACKEND_READINESS_URL:-${SPOTU_BACKEND_READINESS_URL:-http://178.105.95.184:8080/api/readiness}}"
SSH_TARGET="${HETZNER_SSH:-}"
REMOTE_DIR="${HETZNER_APP_DIR:-}"
REMOTE_COMPOSE="${HETZNER_COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_SERVICE="${HETZNER_COMPOSE_SERVICE:-spotu-api}"
DEPLOY_CMD="${HETZNER_DEPLOY_COMMAND:-}"

missing=()
[[ -z "$SSH_TARGET" ]] && missing+=("HETZNER_SSH")
[[ -z "$REMOTE_DIR" ]] && missing+=("HETZNER_APP_DIR")

if [[ ${#missing[@]} -gt 0 ]]; then
  err "Configuration déploiement incomplète."
  echo
  echo "  Copie et complète :"
  echo "    cp scripts/ship/deploy.env.example scripts/ship/deploy.env"
  echo
  echo "  Variables manquantes :"
  for v in "${missing[@]}"; do
    echo "    - $v"
  done
  echo
  echo "  Déploiement serveur (sans registry) :"
  echo "    ssh → cd \$HETZNER_APP_DIR → git pull → docker compose build $COMPOSE_SERVICE → up -d"
  echo "  Readiness par défaut : $READINESS_URL"
  echo
  die "Complète scripts/ship/deploy.env puis relance npm run ship:back"
fi

if [[ -n "$DEPLOY_CMD" ]]; then
  info "Déploiement Hetzner (commande personnalisée) …"
  ssh "$SSH_TARGET" "$DEPLOY_CMD"
else
  info "Déploiement Hetzner : git pull + docker compose build …"
  ssh "$SSH_TARGET" "set -euo pipefail
cd $(printf '%q' "$REMOTE_DIR")
git pull
docker compose -f $(printf '%q' "$REMOTE_COMPOSE") build $(printf '%q' "$COMPOSE_SERVICE")
docker compose -f $(printf '%q' "$REMOTE_COMPOSE") up -d $(printf '%q' "$COMPOSE_SERVICE")"
fi
ok "Déploiement distant terminé."

info "Vérification readiness : $READINESS_URL"
attempts=0
max_attempts="${READINESS_MAX_ATTEMPTS:-12}"
sleep_secs="${READINESS_SLEEP_SECS:-5}"

while [[ $attempts -lt $max_attempts ]]; do
  if curl -fsS --max-time 10 "$READINESS_URL" >/dev/null; then
    ok "Backend prêt : $READINESS_URL"
    exit 0
  fi
  attempts=$((attempts + 1))
  warn "Readiness KO (tentative $attempts/$max_attempts) — nouvel essai dans ${sleep_secs}s …"
  sleep "$sleep_secs"
done

die "Readiness toujours KO après $max_attempts tentatives : $READINESS_URL"
