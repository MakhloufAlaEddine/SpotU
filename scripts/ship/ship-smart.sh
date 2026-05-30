#!/usr/bin/env bash
# Détection intelligente + action adaptée.
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"
# shellcheck source=detect-changes.sh
source "$SHIP_DIR/detect-changes.sh"

require_git_repo

print_detection_report

ACTION="none"

if [[ $NATIVE_DETECTED -eq 1 ]]; then
  if [[ $BACKEND_DETECTED -eq 1 || $FRONTEND_OTA_DETECTED -eq 1 ]]; then
    ACTION="native rebuild required (autres changements présents)"
  else
    ACTION="native rebuild required"
  fi
elif [[ $BACKEND_DETECTED -eq 1 && $FRONTEND_OTA_DETECTED -eq 1 ]]; then
  ACTION="full deploy (backend + OTA)"
elif [[ $BACKEND_DETECTED -eq 1 ]]; then
  ACTION="backend deploy"
elif [[ $FRONTEND_OTA_DETECTED -eq 1 ]]; then
  ACTION="OTA only"
else
  ACTION="nothing to ship"
fi

info "Action selected: $ACTION"
echo

case "$ACTION" in
  "nothing to ship")
    ok "Aucun changement local détecté. Rien à déployer."
    exit 0
    ;;
  "OTA only")
    bash "$SHIP_DIR/ship-front.sh"
    ;;
  "backend deploy")
    bash "$SHIP_DIR/ship-back.sh"
    ;;
  "full deploy (backend + OTA)")
    bash "$SHIP_DIR/ship-all.sh"
    ;;
  "native rebuild required")
    err "Changements natifs détectés — rebuild EAS preview requis (OTA seul insuffisant)."
    echo
    echo "  Android : npm run build:preview:android"
    echo "  iOS     : npm run build:preview:ios"
    echo
    if [[ -t 0 ]]; then
      echo "Lancer un build maintenant ?"
      echo "  1) Android preview"
      echo "  2) iOS preview"
      echo "  3) Les deux"
      echo "  q) Quitter"
      read -r -p "Choix [q]: " choice
      case "${choice:-q}" in
        1) bash "$SHIP_DIR/build-preview-android.sh" ;;
        2) bash "$SHIP_DIR/build-preview-ios.sh" ;;
        3) bash "$SHIP_DIR/build-preview-android.sh"; bash "$SHIP_DIR/build-preview-ios.sh" ;;
        *) warn "Build non lancé."; exit 1 ;;
      esac
    else
      die "Relance en terminal interactif ou lance build:preview:* manuellement."
    fi
    ;;
  "native rebuild required (autres changements présents)")
    err "Changements natifs + autres changements détectés."
    echo
    echo "  1. Rebuild natif preview (Android et/ou iOS)"
    echo "  2. Puis selon le cas : npm run ship:back et/ou npm run ship:front"
    echo
    if [[ $BACKEND_DETECTED -eq 1 ]]; then
      warn "Backend aussi modifié → après rebuild : npm run ship:back"
    fi
    if [[ $FRONTEND_OTA_DETECTED -eq 1 ]]; then
      warn "JS/TS aussi modifié → après rebuild natif, npm run ship:front pour l’OTA"
    fi
    exit 1
    ;;
esac
