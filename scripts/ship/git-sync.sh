#!/usr/bin/env bash
# Commit (si changements) + push branche courante.
set -euo pipefail

SHIP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SHIP_DIR/common.sh"

require_git_repo
require_cmd git

SKIP_GIT="${SHIP_SKIP_GIT:-0}"
SKIP_COMMIT="${SHIP_SKIP_COMMIT:-0}"
SKIP_PUSH="${SHIP_SKIP_PUSH:-0}"

if [[ "$SKIP_GIT" == "1" ]]; then
  warn "SHIP_SKIP_GIT=1 — étape git ignorée."
  exit 0
fi

cd "$ROOT"
BRANCH="$(git branch --show-current)"
info "Branche : $BRANCH"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo
  git status --short
  echo
  if [[ "$SKIP_COMMIT" == "1" ]]; then
    warn "Changements non commités et SHIP_SKIP_COMMIT=1 — arrêt."
    exit 1
  fi
  info "Commit : $SHIP_COMMIT_MSG"
  git add -A
  git commit -m "$SHIP_COMMIT_MSG"
  ok "Commit créé."
else
  ok "Working tree propre (rien à committer)."
fi

if [[ "$SKIP_PUSH" == "1" ]]; then
  warn "SHIP_SKIP_PUSH=1 — push ignoré."
  exit 0
fi

UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "$UPSTREAM" ]]; then
  warn "Pas de branche upstream. Push manuel : git push -u origin $BRANCH"
  exit 0
fi

AHEAD="$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo 0)"
if [[ "$AHEAD" -gt 0 ]] || [[ -n "$(git diff --name-only "@{u}..HEAD" 2>/dev/null || true)" ]]; then
  info "Push vers $UPSTREAM …"
  git push
  ok "Push terminé."
else
  ok "Rien à pousser (à jour avec $UPSTREAM)."
fi
