"""
database.py — Connexion asyncpg pour SpotU

Stratégie de connexion :
  - Local (127.0.0.1 / localhost) : pas de SSL
  - Supabase (Supavisor session mode) : SSL complet avec CA Supabase

SSL production-ready :
  - cafile : certs/supabase-ca.crt (Supabase Root 2021 CA, valide jusqu'en 2031)
  - check_hostname = True
  - verify_mode   = CERT_REQUIRED
  → Pas de CERT_NONE en production.

Configuration env :
  DATABASE_URL        : URL de connexion PostgreSQL (obligatoire)
  SSL_CA_CERT_PATH    : chemin vers le CA cert (optionnel, défaut = certs/supabase-ca.crt)
  APP_ENV             : dev | staging | prod (optionnel, défaut = prod)
                        - dev local  : ssl=False si 127.0.0.1
                        - staging    : ssl CA cert + check_hostname=True
                        - prod       : ssl CA cert + check_hostname=True

Connexion Supabase (Supavisor session mode, port 5432) :
  Format : postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
  Pourquoi session mode et pas la connexion directe ?
    → db.PROJECT.supabase.co:5432 ne résout pas depuis les pods GCP Kubernetes
    → Supavisor session mode (port 5432) = connexion persistante, compatible asyncpg
  Pourquoi pas transaction mode (port 6543) ?
    → Incompatible avec les prepared statements asyncpg

Pool asyncpg pour pgbouncer / Supavisor :
  statement_cache_size=0  → désactive le cache de prepared statements (requis)
"""

import asyncpg
import os
import logging
import json as _json
import ssl
from pathlib import Path
from decimal import Decimal
from typing import Optional

logger = logging.getLogger(__name__)
pool: Optional[asyncpg.Pool] = None

# Chemin du CA cert Supabase (embarqué dans le projet)
_CERT_DIR = Path(__file__).parent / "certs"
_DEFAULT_CA_CERT = _CERT_DIR / "supabase-ca.crt"


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


# ── Création du contexte SSL ──────────────────────────────────────────────────

def _build_ssl_context(database_url: str) -> "ssl.SSLContext | bool":
    """
    Retourne le contexte SSL adapté à l'URL :
      - 127.0.0.1 / localhost → False (pas de SSL)
      - Toute autre URL       → SSLContext avec CA cert Supabase
                                check_hostname=True + CERT_REQUIRED
    """
    if "127.0.0.1" in database_url or "localhost" in database_url:
        return False

    ca_cert = os.environ.get("SSL_CA_CERT_PATH", str(_DEFAULT_CA_CERT))

    if not Path(ca_cert).is_file():
        raise FileNotFoundError(
            f"CA cert introuvable : {ca_cert}\n"
            f"Vérifiez SSL_CA_CERT_PATH ou que {_DEFAULT_CA_CERT} existe."
        )

    ctx = ssl.create_default_context(cafile=ca_cert)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    logger.debug("SSL ctx créé avec CA : %s", ca_cert)
    return ctx


# ── Pool ──────────────────────────────────────────────────────────────────────

async def connect_to_db():
    """
    Crée le pool asyncpg.
    Aucune DDL ni seed n'est exécuté ici.
    Le schéma est géré exclusivement via /migrations/*.sql (run_migrations.py).
    """
    global pool
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL manquant dans l'environnement (.env)")

    _ssl = _build_ssl_context(database_url)
    _is_local = _ssl is False

    import asyncio
    for attempt in range(15):
        try:
            pool = await asyncpg.create_pool(
                database_url,
                min_size=2,
                max_size=10,
                init=_init_connection,
                ssl=_ssl,
                statement_cache_size=0,  # Requis pour pgbouncer / Supavisor
                timeout=15,
                command_timeout=30,
            )
            target = database_url.split("@")[-1] if "@" in database_url else database_url
            ssl_label = "False (local)" if _is_local else "CA cert (CERT_REQUIRED)"
            logger.info("DB pool créé — %s | ssl=%s", target, ssl_label)
            break
        except Exception as e:
            if attempt == 14:
                logger.error(
                    "Impossible de se connecter à la DB après 15 tentatives. "
                    "Vérifiez DATABASE_URL, SSL_CA_CERT_PATH et l'accessibilité du serveur."
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
