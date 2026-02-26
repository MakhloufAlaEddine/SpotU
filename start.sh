#!/bin/bash
# Script de démarrage - à lancer après chaque redémarrage du serveur
set -e

echo "=== Démarrage PostgreSQL ==="
sudo service postgresql start
sleep 3
pg_isready || exit 1

echo "=== Réinitialisation du mot de passe ==="
sudo -u postgres psql -c "ALTER USER winek WITH PASSWORD 'winek2024';"

echo "=== Migration DB ==="
sudo -u postgres psql winek_db << 'SQL'
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ;
ALTER TABLE tag_points ADD COLUMN IF NOT EXISTS event_schedule JSONB DEFAULT NULL;
SQL

echo "=== Démarrage du backend ==="
sudo supervisorctl restart backend
sleep 4

echo "=== Vérification ==="
curl -s http://localhost:8001/api/tag-points?limit=1 | python3 -c "import sys,json; items=json.load(sys.stdin); print(f'✓ {len(items)} tagpoints chargés')"
echo "Backend prêt !"
