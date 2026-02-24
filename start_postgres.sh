#!/bin/bash
# Script de démarrage automatique PostgreSQL pour WINEK
# Ce script installe PostgreSQL si nécessaire, crée la base de données, et démarre le service

set -e

LOG_FILE="/var/log/supervisor/postgres_setup.log"
exec >> "$LOG_FILE" 2>&1

echo "[$(date)] === Démarrage du script PostgreSQL WINEK ==="

# 1. Vérifier si PostgreSQL 15 est installé
if ! command -v pg_ctlcluster &> /dev/null || ! dpkg -l postgresql-15 &>/dev/null; then
    echo "[$(date)] PostgreSQL non trouvé. Installation en cours..."
    apt-get update -qq
    apt-get install -y postgresql postgresql-contrib postgresql-15-postgis-3
    echo "[$(date)] PostgreSQL installé avec succès."
else
    echo "[$(date)] PostgreSQL 15 déjà installé."
fi

# 2. Vérifier si le cluster existe et le démarrer
CLUSTER_STATUS=$(pg_ctlcluster 15 main status 2>&1 || true)
echo "[$(date)] Status cluster: $CLUSTER_STATUS"

if echo "$CLUSTER_STATUS" | grep -q "server is not running\|No such file"; then
    echo "[$(date)] Démarrage du cluster PostgreSQL..."
    pg_ctlcluster 15 main start || true
    sleep 2
elif echo "$CLUSTER_STATUS" | grep -q "server is running"; then
    echo "[$(date)] PostgreSQL déjà en cours d'exécution."
else
    echo "[$(date)] Tentative de démarrage du cluster..."
    pg_ctlcluster 15 main start || true
    sleep 2
fi

# 3. Attendre que PostgreSQL soit prêt
MAX_WAIT=30
WAITED=0
while ! sudo -u postgres psql -c "SELECT 1;" &>/dev/null; do
    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "[$(date)] ERREUR: PostgreSQL ne répond pas après ${MAX_WAIT}s"
        exit 1
    fi
    sleep 1
    WAITED=$((WAITED+1))
done
echo "[$(date)] PostgreSQL est prêt (après ${WAITED}s)."

# 4. Créer l'extension PostGIS sur la base template1
sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS postgis;" template1 2>/dev/null || true

# 5. Créer l'utilisateur winek s'il n'existe pas
USER_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='winek';" 2>/dev/null || echo "")
if [ -z "$USER_EXISTS" ]; then
    echo "[$(date)] Création de l'utilisateur winek..."
    sudo -u postgres psql -c "CREATE USER winek WITH PASSWORD 'winek2024';"
else
    echo "[$(date)] Utilisateur winek déjà existant."
fi

# 6. Créer la base de données winek_db si elle n'existe pas
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='winek_db';" 2>/dev/null || echo "")
if [ -z "$DB_EXISTS" ]; then
    echo "[$(date)] Création de la base winek_db..."
    sudo -u postgres psql -c "CREATE DATABASE winek_db OWNER winek;"
    sudo -u postgres psql -d winek_db -c "CREATE EXTENSION IF NOT EXISTS postgis;"
    sudo -u postgres psql -d winek_db -c "GRANT ALL PRIVILEGES ON DATABASE winek_db TO winek;"
else
    echo "[$(date)] Base winek_db déjà existante."
    # S'assurer que PostGIS est activé
    sudo -u postgres psql -d winek_db -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
fi

echo "[$(date)] === Setup PostgreSQL terminé avec succès ==="

# 7. Garder PostgreSQL en foreground pour supervisor
echo "[$(date)] Passage en mode foreground..."
exec sudo -u postgres /usr/lib/postgresql/15/bin/postgres \
    -D /var/lib/postgresql/15/main \
    -c config_file=/etc/postgresql/15/main/postgresql.conf
