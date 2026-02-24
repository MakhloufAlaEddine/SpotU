#!/bin/bash
# Script de démarrage automatique PostgreSQL pour WINEK

LOG_FILE="/var/log/supervisor/postgres_setup.log"
exec >> "$LOG_FILE" 2>&1

echo "[$(date)] === Démarrage PostgreSQL WINEK ==="

# 1. Installer PostgreSQL si absent
if ! dpkg -l postgresql-15 &>/dev/null 2>&1; then
    echo "[$(date)] Installation PostgreSQL..."
    apt-get update -qq
    apt-get install -y postgresql postgresql-contrib postgresql-15-postgis-3
    echo "[$(date)] Installation terminée."
fi

# 2. Arrêter proprement tout postgres existant
if pg_ctlcluster 15 main status 2>&1 | grep -q "server is running"; then
    echo "[$(date)] Arrêt du postgres existant..."
    pg_ctlcluster 15 main stop 2>/dev/null || true
    sleep 2
fi
# Nettoyer le PID résiduel
rm -f /var/lib/postgresql/15/main/postmaster.pid 2>/dev/null || true

# 3. Démarrer pour la configuration initiale
echo "[$(date)] Démarrage pour setup..."
pg_ctlcluster 15 main start 2>&1
sleep 3

# 4. Attendre que PostgreSQL soit prêt
MAX_WAIT=20
WAITED=0
while ! sudo -u postgres psql -c "SELECT 1;" &>/dev/null; do
    [ $WAITED -ge $MAX_WAIT ] && { echo "[$(date)] ERREUR: timeout"; exit 1; }
    sleep 1; WAITED=$((WAITED+1))
done
echo "[$(date)] Prêt en ${WAITED}s."

# 5. Setup PostGIS + utilisateur + base
sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS postgis;" template1 2>/dev/null || true
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='winek';" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER winek WITH PASSWORD 'winek2024';"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='winek_db';" | grep -q 1; then
    sudo -u postgres psql -c "CREATE DATABASE winek_db OWNER winek;"
    sudo -u postgres psql -d winek_db -c "CREATE EXTENSION IF NOT EXISTS postgis;"
    sudo -u postgres psql -d winek_db -c "GRANT ALL PRIVILEGES ON DATABASE winek_db TO winek;"
fi
sudo -u postgres psql -d winek_db -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
echo "[$(date)] Setup terminé."

# 6. Arrêter avant foreground
pg_ctlcluster 15 main stop 2>&1 || true
sleep 2
rm -f /var/lib/postgresql/15/main/postmaster.pid 2>/dev/null || true

echo "[$(date)] Démarrage en foreground (supervisé)..."

# 7. Démarrer en foreground
exec sudo -u postgres /usr/lib/postgresql/15/bin/postgres \
    -D /var/lib/postgresql/15/main \
    -c config_file=/etc/postgresql/15/main/postgresql.conf
