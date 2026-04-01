#!/usr/bin/env python3
"""
run_migrations.py — Runner de migrations SQL versionnées pour SpotU.

Usage :
  python migrations/run_migrations.py              # Applique toutes les migrations en attente
  python migrations/run_migrations.py --status     # Affiche l'état des migrations
  python migrations/run_migrations.py --dry-run    # Simule sans modifier la BDD
  python migrations/run_migrations.py --new <nom>  # Crée un nouveau fichier de migration
  python migrations/run_migrations.py --help       # Aide

Règles impératives :
  1. Toute modification de la base passe par une nouvelle migration.
  2. Une migration déjà exécutée ne doit JAMAIS être modifiée.
  3. Chaque migration est exécutée UNE SEULE FOIS (contrôle par checksum + UNIQUE).
  4. Une migration échouée n'est JAMAIS enregistrée dans _migrations.
  5. Chaque migration s'exécute dans une transaction — rollback automatique si échec.
  6. Le runtime de l'application ne modifie jamais le schéma.
  7. L'ordre d'exécution est alphanumérique strict : 001, 002, 003, …
"""

import asyncio
import asyncpg
import hashlib
import os
import re
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path


MIGRATIONS_DIR = Path(__file__).parent
ENV_FILE       = MIGRATIONS_DIR.parent / ".env"
_CERT_DEFAULT  = MIGRATIONS_DIR.parent / "certs" / "supabase-ca.crt"

# Nommage attendu : NNN_description_en_snake_case.sql
_NAME_RE = re.compile(r"^\d{3}_[a-z0-9_]+\.sql$")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _load_env() -> None:
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
    """SHA-256 complet du contenu — 64 caractères hex."""
    return hashlib.sha256(content.encode()).hexdigest()


def _sorted_sql_files() -> list[Path]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    for f in files:
        if not _NAME_RE.match(f.name):
            print(
                f"⚠️   Fichier ignoré (nommage non conforme) : {f.name}\n"
                f"    Format attendu : NNN_description.sql  (ex: 004_add_user_settings.sql)",
                file=sys.stderr,
            )
    return [f for f in files if _NAME_RE.match(f.name)]


def _build_ssl(dsn: str) -> "ssl.SSLContext | bool":
    if "127.0.0.1" in dsn or "localhost" in dsn:
        return False
    cert = os.environ.get("SSL_CA_CERT_PATH", str(_CERT_DEFAULT))
    if not Path(cert).is_file():
        raise FileNotFoundError(
            f"CA cert introuvable : {cert}\n"
            "Vérifiez SSL_CA_CERT_PATH ou que backend/certs/supabase-ca.crt existe."
        )
    ctx = ssl.create_default_context(cafile=cert)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


async def _connect(dsn: str) -> asyncpg.Connection:
    """Connexion simple (pas de pool) — suffisant pour un outil CLI."""
    return await asyncpg.connect(
        dsn,
        ssl=_build_ssl(dsn),
        statement_cache_size=0,
        command_timeout=60,
    )


# ── Table _migrations ─────────────────────────────────────────────────────────

async def _ensure_table(conn: asyncpg.Connection) -> None:
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            id          SERIAL      PRIMARY KEY,
            name        TEXT        NOT NULL UNIQUE,
            checksum    TEXT        NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)


async def _get_executed(conn: asyncpg.Connection) -> dict[str, str]:
    rows = await conn.fetch("SELECT name, checksum FROM _migrations ORDER BY id")
    return {r["name"]: r["checksum"] for r in rows}


# ── Vérification anti-tamper ──────────────────────────────────────────────────

def _verify_checksums(
    sql_files: list[Path],
    executed: dict[str, str],
) -> bool:
    """
    Détecte si un fichier de migration déjà appliqué a été modifié.
    Retourne True si tout est cohérent, False sinon.
    """
    ok = True
    for f in sql_files:
        if f.name not in executed:
            continue
        current_cs  = _checksum(f.read_text())
        stored_cs   = executed[f.name]
        # Compatibilité avec les anciens checksums (16 chars, format précédent)
        if len(stored_cs) == 16:
            match = current_cs.startswith(stored_cs)
        else:
            match = current_cs == stored_cs
        if not match:
            print(
                f"\n🚨  ALERTE INTÉGRITÉ : {f.name}\n"
                f"    Checksum stocké  : {stored_cs}\n"
                f"    Checksum actuel  : {current_cs}\n"
                f"    Ce fichier a été modifié après son exécution !\n"
                f"    Action requise   : NE PAS relancer ce fichier.\n"
                f"    Solution         : créer une nouvelle migration pour corriger.",
                file=sys.stderr,
            )
            ok = False
    return ok


# ── Commandes ─────────────────────────────────────────────────────────────────

def cmd_new(name_arg: str) -> None:
    """
    Crée un nouveau fichier de migration avec le prochain numéro séquentiel.
    Usage : python migrations/run_migrations.py --new add_user_settings
    """
    # Normaliser le nom : minuscules, espaces → underscores
    slug = re.sub(r"[^a-z0-9]+", "_", name_arg.lower()).strip("_")
    if not slug:
        print("❌  Nom de migration invalide.", file=sys.stderr)
        sys.exit(1)

    # Trouver le prochain numéro
    existing = sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql"))
    next_num = int(existing[-1].name[:3]) + 1 if existing else 1
    filename = f"{next_num:03d}_{slug}.sql"
    target   = MIGRATIONS_DIR / filename

    if target.exists():
        print(f"❌  Fichier déjà existant : {filename}", file=sys.stderr)
        sys.exit(1)

    template = f"""\
-- Migration {next_num:03d} — {slug.replace("_", " ").title()}
-- Date    : {datetime.now(timezone.utc).strftime("%Y-%m-%d")}
-- Auteur  : (ton nom)
-- Ticket  : (lien issue / PR)
--
-- Description :
--   (Décris ici ce que cette migration fait et POURQUOI.)
--
-- Rollback manuel (si nécessaire) :
--   (Commandes SQL pour annuler manuellement cette migration)

-- === DÉBUT DE LA MIGRATION ===

-- Exemple :
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{{}}';

-- === FIN DE LA MIGRATION ===
"""
    target.write_text(template)
    print(f"✅  Migration créée : migrations/{filename}")
    print(f"    Édite le fichier, puis exécute :")
    print(f"    python migrations/run_migrations.py")


async def cmd_status(conn: asyncpg.Connection) -> None:
    await _ensure_table(conn)
    executed  = await _get_executed(conn)
    sql_files = _sorted_sql_files()

    print(f"\n{'Fichier':<52} {'Statut':<14} Checksum")
    print("─" * 90)
    for f in sql_files:
        if f.name in executed:
            stored = executed[f.name]
            current = _checksum(f.read_text())
            # Compat checksums courts (16 chars) issus de l'ancien runner
            tampered = not (current.startswith(stored) if len(stored) == 16 else current == stored)
            flag = " ⚠️  MODIFIÉ" if tampered else ""
            print(f"  {f.name:<52} ✅ appliqué   {stored}{flag}")
        else:
            print(f"  {f.name:<52} ⏳ en attente")

    pending = [f for f in sql_files if f.name not in executed]
    print(f"\n{len(executed)} appliquée(s), {len(pending)} en attente.\n")

    _verify_checksums(sql_files, executed)


async def cmd_run(
    conn: asyncpg.Connection,
    dry_run: bool = False,
) -> None:
    await _ensure_table(conn)
    executed  = await _get_executed(conn)
    sql_files = _sorted_sql_files()

    # Vérification anti-tamper avant toute exécution
    if not _verify_checksums(sql_files, executed):
        print(
            "\n❌  Migrations interrompues : intégrité compromise.\n"
            "    Corrigez les fichiers signalés avant de continuer.",
            file=sys.stderr,
        )
        sys.exit(1)

    pending = [f for f in sql_files if f.name not in executed]

    if not pending:
        print("✅  Toutes les migrations sont à jour.")
        return

    print(f"▶  {len(pending)} migration(s) en attente :\n")

    for f in pending:
        content = f.read_text()
        cs      = _checksum(content)
        label   = f"  [{f.name}]"

        if dry_run:
            print(f"{label} — simulation (dry-run, non exécuté)")
            continue

        print(f"{label} — en cours…", end=" ", flush=True)

        # ── Transaction atomique : la migration ET son enregistrement sont atomiques.
        # Si le SQL échoue → rollback complet → _migrations n'est PAS modifié.
        try:
            async with conn.transaction():
                await conn.execute(content)
                await conn.execute(
                    "INSERT INTO _migrations (name, checksum) VALUES ($1, $2)",
                    f.name, cs,
                )
            print("✅")
        except asyncpg.PostgresError as exc:
            print(f"\n❌  ERREUR SQL [{f.name}]")
            print(f"    Code     : {exc.sqlstate}")
            print(f"    Message  : {exc}")
            print(f"    → Rollback effectué. _migrations NON modifié.")
            print(f"    → Corrigez le fichier SQL et relancez.")
            sys.exit(1)
        except Exception as exc:
            print(f"\n❌  ERREUR INATTENDUE [{f.name}] : {exc}")
            print(f"    → Rollback effectué. _migrations NON modifié.")
            sys.exit(1)

    print(f"\n✅  Migration(s) terminée(s).\n")


# ── Entrée CLI ────────────────────────────────────────────────────────────────

async def main() -> None:
    args = sys.argv[1:]

    if "--help" in args or "-h" in args:
        print(__doc__)
        sys.exit(0)

    # --new ne nécessite pas de connexion DB
    if "--new" in args:
        idx = args.index("--new")
        if idx + 1 >= len(args):
            print("❌  Usage : --new <nom_de_migration>", file=sys.stderr)
            sys.exit(1)
        cmd_new(args[idx + 1])
        return

    _load_env()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("❌  DATABASE_URL non défini dans .env", file=sys.stderr)
        sys.exit(1)

    conn = await _connect(dsn)
    try:
        if "--status" in args:
            await cmd_status(conn)
        else:
            await cmd_run(conn, dry_run="--dry-run" in args)
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
