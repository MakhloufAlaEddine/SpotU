"""
database.py — Connexion asyncpg pour SpotU

Stratégie de connexion :
  - Développement : connexion directe PostgreSQL local (127.0.0.1)
  - Production    : Supavisor session mode (port 5432) sur aws-0-{region}.pooler.supabase.com

Pourquoi Supavisor session mode et pas la connexion directe Supabase ?
  → db.PROJECT.supabase.co:5432 ne résout pas depuis les pods Kubernetes
    hébergés sur GCP (DNS interne restreint, pas d'IPv6 sortant).
  → La connexion directe sera privilégiée en production si l'hébergeur
    supporte IPv6 ou si l'IP publique est ajoutée à l'allowlist Supabase.

Pourquoi pas le transaction mode (port 6543) ?
  → Incompatible avec les prepared statements asyncpg.
  → Session mode (5432) = connexion persistante avec recycling, compatible asyncpg.

Configuration pool pour pgbouncer / Supavisor :
  → statement_cache_size=0  : désactive le cache de prepared statements
  → ssl='require'           : obligatoire côté Supabase (ignoré sur 127.0.0.1)
  → min/max_size conservatif pour nano tier
"""

import asyncpg
import os
import logging
import json as _json
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)
pool: Optional[asyncpg.Pool] = None


# ── Helpers de sérialisation ───────────────────────────────────────────────────

def row_to_dict(row) -> dict:
    """Convert asyncpg Record to a JSON-serializable dict."""
    if row is None:
        return None
    result = {}
    for key, val in dict(row).items():
        if isinstance(val, Decimal):
            result[key] = float(val)
        elif hasattr(val, 'isoformat'):
            result[key] = val.isoformat()
        else:
            result[key] = val
    return result


def rows_to_list(rows) -> list:
    return [row_to_dict(row) for row in rows]


# ── Init codec JSON par connexion ─────────────────────────────────────────────

async def _init_connection(conn):
    """Installe le codec JSONB/JSON pour chaque connexion du pool."""
    await conn.set_type_codec(
        'jsonb', encoder=_json.dumps, decoder=_json.loads, schema='pg_catalog'
    )
    await conn.set_type_codec(
        'json', encoder=_json.dumps, decoder=_json.loads, schema='pg_catalog'
    )


# ── Pool ──────────────────────────────────────────────────────────────────────

async def connect_to_db():
    """
    Crée le pool asyncpg.

    - Connexion locale (127.0.0.1 / localhost) : ssl=False
    - Connexion distante (Supabase, etc.)       : ssl='require', statement_cache_size=0

    Aucune DDL ni seed n'est exécuté ici.
    Le schéma est géré exclusivement via /migrations/*.sql (run_migrations.py).
    """
    global pool
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL manquant dans l'environnement (.env)")

    _is_local = "127.0.0.1" in database_url or "localhost" in database_url
    _ssl = False if _is_local else 'require'
    # statement_cache_size=0 requis pour pgbouncer / Supavisor (session + transaction mode)
    _stmt_cache = 0

    import asyncio
    for attempt in range(15):
        try:
            pool = await asyncpg.create_pool(
                database_url,
                min_size=2,
                max_size=10,
                init=_init_connection,
                ssl=_ssl,
                statement_cache_size=_stmt_cache,
                timeout=15,
                command_timeout=30,
            )
            target = database_url.split("@")[-1] if "@" in database_url else database_url
            logger.info("DB pool créé — %s (ssl=%s)", target, _ssl)
            break
        except Exception as e:
            if attempt == 14:
                logger.error(
                    "Impossible de se connecter à la DB après 15 tentatives. "
                    "Vérifiez DATABASE_URL et l'accessibilité du serveur."
                )
                raise
            wait = min(2 ** attempt, 30)
            logger.warning(
                "DB non disponible (tentative %d/15), retry dans %ds… (%s)",
                attempt + 1, wait, e,
            )
            await asyncio.sleep(wait)


async def close_db():
    global pool
    if pool:
        await pool.close()


def get_pool():
    return pool
