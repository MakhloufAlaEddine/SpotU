#!/bin/bash
# Script de démarrage automatique PostgreSQL pour WINEK
# Ce script installe PostgreSQL si nécessaire, crée la base de données, et démarre le service

LOG_FILE="/var/log/supervisor/postgres_setup.log"
exec >> "$LOG_FILE" 2>&1

echo "[$(date)] === Démarrage du script PostgreSQL WINEK ==="

# 1. Vérifier si PostgreSQL 15 est installé
if ! command -v pg_ctlcluster &> /dev/null || ! dpkg -l postgresql-15 &>/dev/null 2>&1; then
    echo "[$(date)] PostgreSQL non trouvé. Installation en cours..."
    apt-get update -qq
    apt-get install -y postgresql postgresql-contrib postgresql-15-postgis-3
    echo "[$(date)] PostgreSQL installé avec succès."
else
    echo "[$(date)] PostgreSQL 15 déjà installé."
fi

# 2. Arrêter proprement tout postgres existant pour éviter le conflit de PID
CLUSTER_STATUS=$(pg_ctlcluster 15 main status 2>&1 || true)
if echo "$CLUSTER_STATUS" | grep -q "server is running"; then
    echo "[$(date)] Arrêt propre du PostgreSQL existant avant démarrage supervisé..."
    pg_ctlcluster 15 main stop -m fast 2>/dev/null || true
    sleep 2
    # Supprimer le PID si toujours présent
    rm -f /var/run/postgresql/.s.PGSQL.5432.lock /var/lib/postgresql/15/main/postmaster.pid 2>/dev/null || true
fi

# 3. Initialiser le cluster s'il n'existe pas
if [ ! -f /var/lib/postgresql/15/main/PG_VERSION ]; then
    echo "[$(date)] Initialisation du cluster PostgreSQL..."
    sudo -u postgres /usr/lib/postgresql/15/bin/initdb -D /var/lib/postgresql/15/main
fi

echo "[$(date)] === Setup PostgreSQL (démarrage temporaire pour initialisation) ==="

# 4. Démarrer temporairement pour créer l'utilisateur et la base
sudo -u postgres /usr/lib/postgresql/15/bin/pg_ctl \
    -D /var/lib/postgresql/15/main \
    -l /var/log/postgresql/postgresql-15-main.log \
    start -w

# 5. Attendre que PostgreSQL soit prêt
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
echo "[$(date)] PostgreSQL prêt en ${WAITED}s."

# 6. PostGIS sur template1
sudo -u postgres psql -c "CREATE EXTENSION IF NOT EXISTS postgis;" template1 2>/dev/null || true

# 7. Créer l'utilisateur winek s'il n'existe pas
USER_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='winek';" 2>/dev/null || echo "")
if [ -z "$USER_EXISTS" ]; then
    echo "[$(date)] Création de l'utilisateur winek..."
    sudo -u postgres psql -c "CREATE USER winek WITH PASSWORD 'winek2024';"
else
    echo "[$(date)] Utilisateur winek déjà existant."
fi

# 8. Créer la base de données winek_db si elle n'existe pas
DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='winek_db';" 2>/dev/null || echo "")
if [ -z "$DB_EXISTS" ]; then
    echo "[$(date)] Création de la base winek_db..."
    sudo -u postgres psql -c "CREATE DATABASE winek_db OWNER winek;"
    sudo -u postgres psql -d winek_db -c "CREATE EXTENSION IF NOT EXISTS postgis;"
    sudo -u postgres psql -d winek_db -c "GRANT ALL PRIVILEGES ON DATABASE winek_db TO winek;"
else
    echo "[$(date)] Base winek_db déjà existante."
    sudo -u postgres psql -d winek_db -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
fi

# 9. Arrêter le postgres temporaire avant de démarrer en foreground
echo "[$(date)] Arrêt du postgres temporaire..."
sudo -u postgres /usr/lib/postgresql/15/bin/pg_ctl \
    -D /var/lib/postgresql/15/main stop -m fast -w
sleep 1

echo "[$(date)] === Démarrage de PostgreSQL en mode foreground (supervisé) ==="

# 10. Démarrer en foreground pour supervisor
exec sudo -u postgres /usr/lib/postgresql/15/bin/postgres \
    -D /var/lib/postgresql/15/main \
    -c config_file=/etc/postgresql/15/main/postgresql.conf
