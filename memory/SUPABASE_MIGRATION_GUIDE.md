# Guide — Finalisation migration Supabase (Phase 1)

## Situation actuelle (après refactoring)

| Élément | Statut |
|---------|--------|
| `database.py` — DDL runtime | ✅ Supprimé (80 lignes, zéro CREATE/ALTER) |
| `server.py` — seed auto-startup | ✅ Supprimé |
| `seed.py` — CLI manuel | ✅ Guard `if __name__ == '__main__'` ajouté |
| Migration 003 (colonnes legacy) | ✅ Appliquée localement |
| Export données locales | ✅ `/tmp/data_export_v2.sql` (schema propre) |
| Connexion Supabase depuis le pod | ⚠️ Bloquée (IP allowlist) |

---

## Blocage réseau identifié

- **IP publique du pod** : `34.170.12.145` (Google Cloud)
- **Hostname direct Supabase** (`db.PROJECT.supabase.co:5432`) : DNS ne résout pas depuis ce pod
- **Supavisor session mode** (`aws-0-eu-west-1.pooler.supabase.com:5432`) : TCP accessible mais authentification bloquée
- **Cause** : L'IP `34.170.12.145` n'est pas dans l'allowlist de connexion Supabase

---

## Étapes pour finaliser la connexion Supabase

### Étape 1 — Autoriser l'IP du pod dans Supabase

1. Aller sur [https://supabase.com/dashboard/project/dylqzppapvespmfhcobf/settings/database](https://supabase.com/dashboard/project/dylqzppapvespmfhcobf/settings/database)
2. Section **"Connection pooling"** → **"Allowed IPs"**
3. Ajouter `34.170.12.145/32` (ou `0.0.0.0/0` pour autoriser toutes les IPs)
4. Sauvegarder

### Étape 2 — Tester la connexion Supabase depuis le pod

```bash
cd /app/backend && python -c "
import asyncio, asyncpg
async def test():
    conn = await asyncpg.connect(
        host='aws-0-eu-west-1.pooler.supabase.com',
        port=5432,
        user='postgres.dylqzppapvespmfhcobf',
        password='[MOT_DE_PASSE]',
        database='postgres',
        ssl='require',
        statement_cache_size=0,
        timeout=15
    )
    rows = await conn.fetch(\"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LIMIT 5\")
    print('OK:', [r['tablename'] for r in rows])
    await conn.close()
asyncio.run(test())
"
```

### Étape 3 — Appliquer les migrations sur Supabase

```bash
# 1. Activer Supabase dans .env
# Commenter DATABASE_URL local, décommenter la ligne Supabase

# 2. Lancer les migrations (001 → 002 → 003)
cd /app/backend && python migrations/run_migrations.py

# 3. Vérifier
cd /app/backend && python migrations/run_migrations.py --status
```

### Étape 4 — Importer les données locales dans Supabase

```bash
# Utiliser psql avec l'URL Supabase (via pooler port 5432)
PGPASSWORD='[MOT_DE_PASSE]' psql \
  "host=aws-0-eu-west-1.pooler.supabase.com port=5432 user=postgres.dylqzppapvespmfhcobf dbname=postgres sslmode=require" \
  --set ON_ERROR_STOP=1 \
  -f /tmp/data_export_v2.sql
```

### Étape 5 — Redémarrer le backend avec Supabase

```bash
# Mettre à jour DATABASE_URL dans .env (voir commentaire dans le fichier)
# Redémarrer
sudo supervisorctl restart backend
```

---

## URL de connexion Supabase (Supavisor session mode)

```
postgresql://postgres.dylqzppapvespmfhcobf:[MOT_DE_PASSE]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

**Pourquoi Supavisor session mode (port 5432) et pas la connexion directe ?**
- `db.dylqzppapvespmfhcobf.supabase.co:5432` : hostname ne résout pas depuis les pods GCP
- Supavisor session mode = connexion persistante compatible asyncpg
- Transaction mode (port 6543) : incompatible avec les prepared statements

**En production** : si l'hébergeur supporte IPv6 ou si l'IP est stable,
utiliser la connexion directe (`db.PROJECT.supabase.co:5432`).

---

## Configuration asyncpg (déjà en place dans database.py)

```python
pool = await asyncpg.create_pool(
    database_url,
    min_size=2,
    max_size=10,
    init=_init_connection,
    ssl='require',           # Obligatoire pour Supabase (auto-détecté : False pour local)
    statement_cache_size=0,  # Requis pour Supavisor/pgbouncer
    timeout=15,
    command_timeout=30,
)
```
