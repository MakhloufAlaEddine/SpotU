#!/usr/bin/env python3
"""
run_migrations.py — Runner de migrations SQL versionnées.

Usage :
  python migrations/run_migrations.py              # applique toutes les migrations en attente
  python migrations/run_migrations.py --status     # affiche l'état des migrations
  python migrations/run_migrations.py --dry-run    # simule sans modifier la BDD
  python migrations/run_migrations.py --help       # aide

Règles :
  - Chaque fichier .sql est exécuté UNE SEULE FOIS et tracé dans _migrations.
  - Les fichiers sont exécutés dans l'ordre alphanumérique (001, 002, …).
  - Une migration déjà exécutée ne sera JAMAIS relancée.
  - Ne JAMAIS modifier un fichier .sql après sa première exécution.
"""

import asyncio
import asyncpg
import hashlib
import os
import sys
from pathlib import Path


MIGRATIONS_DIR = Path(__file__).parent
ENV_FILE       = MIGRATIONS_DIR.parent / ".env"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _load_env():
    """Charge le .env sans dépendance externe (pas de python-dotenv requis)."""
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), val)


def _checksum(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()[:16]


async def _get_pool(dsn: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn,
        ssl="require",
        min_size=1,
        max_size=3,
        command_timeout=60,
    )


# ─── Logique principale ───────────────────────────────────────────────────────

async def _ensure_migrations_table(conn):
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            id          SERIAL      PRIMARY KEY,
            name        TEXT        NOT NULL UNIQUE,
            checksum    TEXT        NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)


async def _get_executed(conn) -> dict[str, str]:
    rows = await conn.fetch("SELECT name, checksum FROM _migrations ORDER BY id")
    return {r["name"]: r["checksum"] for r in rows}


async def run(dry_run: bool = False, status_only: bool = False):
    _load_env()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("❌  DATABASE_URL non défini dans .env", file=sys.stderr)
        sys.exit(1)

    pool = await _get_pool(dsn)
    async with pool.acquire() as conn:
        await _ensure_migrations_table(conn)
        executed = await _get_executed(conn)

        sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

        # ── Mode status ──────────────────────────────────────────────────────
        if status_only:
            print(f"\n{'Fichier':<50} {'Statut':<12} Checksum")
            print("─" * 80)
            for f in sql_files:
                if f.name in executed:
                    print(f"  {f.name:<50} ✅ appliqué  {executed[f.name]}")
                else:
                    print(f"  {f.name:<50} ⏳ en attente")
            pending = [f for f in sql_files if f.name not in executed]
            print(f"\n{len(executed)} appliquée(s), {len(pending)} en attente.\n")
            await pool.close()
            return

        # ── Mode run ─────────────────────────────────────────────────────────
        pending = [f for f in sql_files if f.name not in executed]

        if not pending:
            print("✅  Toutes les migrations sont à jour.")
            await pool.close()
            return

        print(f"▶  {len(pending)} migration(s) en attente :\n")

        for f in pending:
            content = f.read_text()
            cs = _checksum(content)
            label = f"  [{f.name}]"

            if dry_run:
                print(f"{label} — simulation (dry-run, non exécuté)")
                continue

            print(f"{label} — en cours…", end=" ", flush=True)
            try:
                await conn.execute(content)
                await conn.execute(
                    "INSERT INTO _migrations (name, checksum) VALUES ($1, $2)",
                    f.name, cs,
                )
                print("✅")
            except Exception as exc:
                print(f"❌  ERREUR : {exc}", file=sys.stderr)
                await pool.close()
                sys.exit(1)

        print(f"\n✅  Migration(s) terminée(s).\n")

    await pool.close()


# ─── Entrée CLI ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--help" in sys.argv or "-h" in sys.argv:
        print(__doc__)
        sys.exit(0)

    asyncio.run(run(
        dry_run    = "--dry-run" in sys.argv,
        status_only= "--status"  in sys.argv,
    ))
