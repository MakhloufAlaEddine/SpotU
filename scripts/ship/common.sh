#!/usr/bin/env bash
# Bibliothèque partagée pour les scripts ship SpotU.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHIP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_DIR="$ROOT/backend-java"
DEPLOY_ENV_FILE="$SHIP_DIR/deploy.env"

EAS_CHANNEL="${EAS_CHANNEL:-preview}"
EAS_UPDATE_MESSAGE="${EAS_UPDATE_MESSAGE:-preview OTA $(date +%Y-%m-%d\ %H:%M)}"
SHIP_COMMIT_MSG="${SHIP_COMMIT_MSG:-chore: ship $(date +%Y-%m-%d\ %H:%M)}"
SPOTU_BACKEND_READINESS_URL="${SPOTU_BACKEND_READINESS_URL:-http://178.105.95.184:8080/api/readiness}"

# shellcheck disable=SC2034
readonly ROOT FRONTEND_DIR BACKEND_DIR SHIP_DIR DEPLOY_ENV_FILE

_color() {
  local code="$1"
  shift
  printf '\033[%sm%s\033[0m\n' "$code" "$*"
}

info()  { _color '1;36' "→ $*"; }
ok()    { _color '1;32' "✔ $*"; }
warn()  { _color '1;33' "⚠ $*"; }
err()   { _color '1;31' "✖ $*" >&2; }

die() {
  err "$*"
  exit 1
}

load_deploy_env() {
  if [[ -f "$DEPLOY_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "$DEPLOY_ENV_FILE"
    set +a
    info "Config déploiement chargée : $DEPLOY_ENV_FILE"
  else
    warn "Fichier absent : $DEPLOY_ENV_FILE (voir scripts/ship/deploy.env.example)"
  fi
}

print_ota_instructions() {
  echo
  ok "Mise à jour OTA publiée sur le channel « ${EAS_CHANNEL} »."
  echo
  echo "  Sur iOS et Android (build preview installé) :"
  echo "    1. Fermer complètement l’app SpotU (swipe / multitâche)"
  echo "    2. Rouvrir l’app (parfois 2 lancements nécessaires)"
  echo
}

print_apk_reinstall_note() {
  echo
  warn "Build Android preview : réinstalle l’APK sur le téléphone (désinstalle l’ancienne version si besoin)."
  echo "  Lien de téléchargement affiché par EAS à la fin du build."
  echo
}

print_ios_install_note() {
  echo
  warn "Build iOS preview : installe via le lien EAS (page expo.dev → Install)."
  echo "  Réglages → Général → Gestion VPN et appareils → faire confiance au développeur si demandé."
  echo
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Commande requise introuvable : $cmd"
}

require_git_repo() {
  git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "Ce dossier n’est pas un dépôt git : $ROOT"
}
