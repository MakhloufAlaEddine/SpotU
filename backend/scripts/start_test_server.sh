#!/usr/bin/env bash
# =============================================================================
# start_test_server.sh — Démarre un backend de test sur le port 8002
#                        pointant sur winek_test (isolation HTTP API tests)
#
# Usage :
#   bash /app/backend/scripts/start_test_server.sh        # démarrage en arrière-plan
#   bash /app/backend/scripts/start_test_server.sh --stop # arrêt
#
# Ensuite, lancer les tests HTTP avec :
#   EXPO_PUBLIC_BACKEND_URL=http://localhost:8002 \
#   bash /app/backend/scripts/run_tests.sh
# =============================================================================
set -euo pipefail

PID_FILE="/tmp/spotu_test_server.pid"
DB_URL="postgresql://winek_test:WinekTest2024!@127.0.0.1:5432/winek_test"
LOG_FILE="/tmp/spotu_test_server.log"

if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    kill "$PID" 2>/dev/null && echo "✅  Serveur de test arrêté (PID $PID)" || echo "⚠️  Processus déjà arrêté"
    rm -f "$PID_FILE"
  else
    echo "⚠️  Aucun serveur de test en cours"
  fi
  exit 0
fi

echo "Démarrage du backend de test sur :8002 → winek_test..."
cd /app/backend

DATABASE_URL="$DB_URL" \
  python -m uvicorn server:app \
  --host 127.0.0.1 \
  --port 8002 \
  --log-level warning \
  > "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
sleep 2

# Vérifier que le serveur est UP
if curl -sf http://localhost:8002/api/liveness > /dev/null 2>&1; then
  echo "✅  Serveur de test UP sur http://localhost:8002"
  echo "   PID: $(cat $PID_FILE) | Logs: $LOG_FILE"
  echo ""
  echo "Lancer les tests HTTP isolés :"
  echo "  EXPO_PUBLIC_BACKEND_URL=http://localhost:8002 bash /app/backend/scripts/run_tests.sh"
else
  echo "❌  Serveur de test n'a pas démarré — voir $LOG_FILE"
  cat "$LOG_FILE" | tail -20
  exit 1
fi
