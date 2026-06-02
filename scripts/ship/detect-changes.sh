#!/usr/bin/env bash
# Détecte backend / frontend OTA / natif depuis HEAD (working tree + index).
# Usage : source detect-changes.sh && detect_changes && echo "$BACKEND_DETECTED"
set -euo pipefail

# Peut être sourcé après common.sh (ex. ship-smart.sh) — ne pas réassigner SHIP_DIR (readonly).
if [[ -z "${ROOT:-}" ]]; then
  _detect_ship_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # shellcheck source=common.sh
  source "$_detect_ship_dir/common.sh"
  unset _detect_ship_dir
fi

BACKEND_DETECTED=0
FRONTEND_OTA_DETECTED=0
NATIVE_DETECTED=0
CHANGED_FILES=()

is_native_path() {
  local f="$1"
  case "$f" in
    frontend/app.json|frontend/app.config.js|frontend/app.config.ts|frontend/eas.json|frontend/babel.config.js)
      return 0 ;;
    frontend/package.json|frontend/package-lock.json)
      return 0 ;;
    frontend/ios/*|frontend/android/*)
      return 0 ;;
    frontend/patches/*)
      return 0 ;;
  esac
  return 1
}

is_backend_path() {
  local f="$1"
  [[ "$f" == backend-java/* ]]
}

is_frontend_ota_path() {
  local f="$1"
  case "$f" in
    frontend/node_modules/*|frontend/dist/*|frontend/.expo/*|frontend/.metro-cache/*)
      return 1 ;;
    frontend/*)
      is_native_path "$f" && return 1
      return 0 ;;
  esac
  return 1
}

collect_changed_files() {
  CHANGED_FILES=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && CHANGED_FILES+=("$f")
  done < <(
    {
      git -C "$ROOT" diff --name-only HEAD 2>/dev/null || true
      git -C "$ROOT" diff --cached --name-only 2>/dev/null || true
      git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null || true
    } | sort -u
  )
}

detect_changes() {
  BACKEND_DETECTED=0
  FRONTEND_OTA_DETECTED=0
  NATIVE_DETECTED=0

  collect_changed_files

  local f
  # Bash 3.2 + set -u : "${arr[@]}" sur tableau vide → « unbound variable »
  for f in ${CHANGED_FILES+"${CHANGED_FILES[@]}"}; do
    [[ -z "$f" ]] && continue
    if is_backend_path "$f"; then
      BACKEND_DETECTED=1
    fi
    if is_native_path "$f"; then
      NATIVE_DETECTED=1
    fi
    if is_frontend_ota_path "$f"; then
      FRONTEND_OTA_DETECTED=1
    fi
  done
}

print_detection_report() {
  detect_changes
  echo
  info "Analyse des changements (depuis HEAD) :"
  echo "  Backend changes detected:        $([[ $BACKEND_DETECTED -eq 1 ]] && echo yes || echo no)"
  echo "  Frontend OTA changes detected:   $([[ $FRONTEND_OTA_DETECTED -eq 1 ]] && echo yes || echo no)"
  echo "  Native changes detected:         $([[ $NATIVE_DETECTED -eq 1 ]] && echo yes || echo no)"
  if [[ ${#CHANGED_FILES[@]} -gt 0 ]]; then
    echo "  Fichiers (${#CHANGED_FILES[@]}) :"
    local f
    for f in ${CHANGED_FILES+"${CHANGED_FILES[@]}"}; do
      [[ -n "$f" ]] && echo "    - $f"
    done
  else
    echo "  Fichiers : (aucun changement local)"
  fi
  echo
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  print_detection_report
fi
