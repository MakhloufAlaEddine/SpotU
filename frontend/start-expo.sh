#!/bin/bash
# Script de démarrage Expo robuste
# Tue tous les processus ngrok existants avant de démarrer
# pour éviter les conflits de sous-domaine "delivery-badges"

echo "[start-expo] Nettoyage des processus ngrok existants..."
pkill -f "ngrok" 2>/dev/null || true
sleep 2

# Vérifier que le port 4040 est libéré
RETRY=0
while ss -tlnp 2>/dev/null | grep -q ":404[0-9]" && [ $RETRY -lt 10 ]; do
    echo "[start-expo] Attente libération port ngrok... ($RETRY/10)"
    sleep 1
    RETRY=$((RETRY+1))
done

echo "[start-expo] Démarrage d'Expo..."
exec env CI=false yarn expo start --tunnel --port 3000
