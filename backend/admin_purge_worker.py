"""
admin_purge_worker.py — Worker de purge différée des fichiers R2 orphelins

Fonctionnement :
  1. Lit les entrées `pending_file_deletions` avec status='pending'
     dont `scheduled_at < NOW() - INTERVAL '<retention_days> days'`
  2. Pour chaque entrée :
     a. Mark status='processing' (lock optimiste, idempotent)
     b. Tente la suppression côté R2 ou filesystem
     c. Mark status='deleted' (succès) ou 'failed' (erreur réelle)
  3. Un échec individuel n'arrête pas le batch
  4. En mode dry_run=True : lit et qualifie les entrées sans supprimer

Garanties :
  - Idempotent : un fichier déjà absent côté R2 → status='deleted' (succès silencieux)
  - Jamais de suppression de données métier principales
  - Logs structurés à chaque étape
  - Max <batch_size> fichiers par exécution (protection contre les runs trop longs)

Usage manuel :
  python3 admin_purge_worker.py --retention-days 30 --batch-size 100 [--dry-run]

Usage programmatique (depuis l'API) :
  result = await run_purge(pool, dry_run=True, retention_days=30, batch_size=100)
"""

import asyncio
import argparse
import logging
import os
import sys
from datetime import datetime, timezone, timedelta
from typing import TypedDict

logger = logging.getLogger("purge_worker")

# ── Résultat d'une exécution ───────────────────────────────────────────────────

class PurgeResult(TypedDict):
    scanned:     int   # Entrées lues en DB (status=pending et éligibles)
    eligible:    int   # Entrées dont scheduled_at >= seuil de rétention
    deleted:     int   # Fichiers supprimés avec succès (incluant "déjà absent")
    failed:      int   # Échecs irrécupérables
    skipped:     int   # Sauts (URL vide, non R2, déjà traité)
    dry_run:     bool
    details:     list[dict]


# ── Suppression d'un fichier unique ───────────────────────────────────────────

async def _delete_single_file(url: str) -> tuple[bool, str | None]:
    """
    Supprime un fichier depuis R2 ou le filesystem local.

    Retourne (success, error_message).
      success=True  → fichier supprimé OU déjà absent (idempotent)
      success=False → erreur réelle à logger
    """
    if not url or not url.strip():
        return True, None  # URL vide = rien à faire → succès silencieux

    try:
        r2_public_url = (os.environ.get("R2_PUBLIC_URL") or "").rstrip("/")

        # ── Fichier R2 ──────────────────────────────────────────────────────
        if r2_public_url and url.startswith(r2_public_url):
            try:
                from r2_storage import _cfg, is_r2_configured
                import boto3
                from botocore.exceptions import ClientError

                if not is_r2_configured():
                    # R2 non configuré en local — on marque comme supprimé pour éviter les loops
                    logger.warning(f"R2 non configuré, skip suppression: {url}")
                    return True, None

                cfg = _cfg()
                key = url[len(r2_public_url):].lstrip("/")
                if not key:
                    return True, None

                client = boto3.client(
                    "s3",
                    endpoint_url=cfg["endpoint"],
                    aws_access_key_id=cfg["access_key_id"],
                    aws_secret_access_key=cfg["secret_access_key"],
                    region_name="auto",
                )
                client.delete_object(Bucket=cfg["bucket"], Key=key)
                logger.info(f"[PURGE] R2 delete OK: {key}")
                return True, None

            except Exception as exc:
                # Vérifier si l'objet n'existait pas (déjà supprimé = succès)
                try:
                    from botocore.exceptions import ClientError as CE
                    if isinstance(exc, CE):
                        code = exc.response.get("Error", {}).get("Code", "")
                        if code in ("NoSuchKey", "404"):
                            logger.info(f"[PURGE] Fichier déjà absent R2 (idempotent): {url}")
                            return True, None
                except Exception:
                    pass
                err = f"R2 ClientError: {exc}"
                logger.warning(f"[PURGE] Échec suppression R2: {url} — {exc}")
                return False, err

        # ── Fichier local filesystem ─────────────────────────────────────────
        if "/api/uploads/" in url:
            from pathlib import Path
            uploads_dir = Path("/app/backend/uploads").resolve()
            filename = url.split("/api/uploads/")[-1].split("?")[0]
            try:
                filepath = (uploads_dir / filename).resolve()
                filepath.relative_to(uploads_dir)  # anti path-traversal
            except (ValueError, Exception) as e:
                logger.warning(f"[PURGE] Path traversal bloqué: {filename!r}")
                return True, None  # On marque supprimé pour éviter les retries

            try:
                filepath.unlink(missing_ok=True)
                logger.info(f"[PURGE] Local delete OK: {filename}")
                return True, None
            except Exception as exc:
                err = f"Local delete error: {exc}"
                logger.warning(f"[PURGE] Échec suppression locale: {filename} — {exc}")
                return False, err

        # ── URL non reconnue ─────────────────────────────────────────────────
        logger.info(f"[PURGE] URL non gérée (skip idempotent): {url}")
        return True, None  # Marquer comme supprimé pour ne pas rejouer indéfiniment

    except Exception as exc:
        err = f"Erreur inattendue: {exc}"
        logger.error(f"[PURGE] Erreur fatale sur {url}: {exc}", exc_info=True)
        return False, err


# ── Worker principal ───────────────────────────────────────────────────────────

async def run_purge(
    pool,
    dry_run: bool = False,
    retention_days: int = 30,
    batch_size: int = 100,
    retry_failed: bool = False,
) -> PurgeResult:
    """
    Exécute un cycle de purge différée.

    Args:
        pool            : asyncpg connection pool
        dry_run         : si True, ne supprime rien (lecture seule + simulation)
        retention_days  : nombre de jours après scheduled_at avant purge (défaut 30)
        batch_size      : nombre maximum de fichiers à traiter par run
        retry_failed    : si True, re-tente aussi les entrées en status='failed'

    Returns:
        PurgeResult TypedDict avec stats détaillées
    """
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    result: PurgeResult = {
        "scanned":  0,
        "eligible": 0,
        "deleted":  0,
        "failed":   0,
        "skipped":  0,
        "dry_run":  dry_run,
        "details":  [],
    }

    # Statuts à traiter
    target_statuses = ["pending"]
    if retry_failed:
        target_statuses.append("failed")

    async with pool.acquire() as conn:
        # ── Sélection des entrées éligibles ───────────────────────────────────
        rows = await conn.fetch(
            f"""SELECT id, file_url, entity_type, entity_id, scheduled_at,
                       status, attempt_count, error_message
                FROM pending_file_deletions
                WHERE status = ANY($1::text[])
                  AND scheduled_at < $2
                ORDER BY scheduled_at ASC
                LIMIT $3""",
            target_statuses, cutoff, batch_size
        )

        result["scanned"]  = len(rows)
        result["eligible"] = len(rows)

        if dry_run:
            # Mode dry_run : classer sans modifier
            for row in rows:
                detail = {
                    "id":          row["id"],
                    "file_url":    row["file_url"],
                    "entity_type": row["entity_type"],
                    "entity_id":   row["entity_id"],
                    "scheduled_at": row["scheduled_at"].isoformat() if row["scheduled_at"] else None,
                    "current_status": row["status"],
                    "attempt_count": row["attempt_count"],
                    "action": "would_delete" if row["file_url"] else "would_skip",
                }
                if not row["file_url"] or not row["file_url"].strip():
                    result["skipped"] += 1
                    detail["action"] = "would_skip_empty_url"
                else:
                    result["deleted"] += 1  # prévu pour suppression
                result["details"].append(detail)
            logger.info(
                f"[PURGE DRY-RUN] retention={retention_days}j cutoff={cutoff.date()} "
                f"éligibles={result['eligible']} prévus_suppression={result['deleted']} skipped={result['skipped']}"
            )
            return result

        # ── Mode réel : traitement entrée par entrée ───────────────────────────
        for row in rows:
            file_id  = row["id"]
            file_url = row["file_url"]

            # URL vide → skip immédiat
            if not file_url or not file_url.strip():
                await conn.execute(
                    """UPDATE pending_file_deletions
                       SET status='skipped', processed_at=$1, last_attempt_at=$1
                       WHERE id=$2""",
                    now, file_id
                )
                result["skipped"] += 1
                result["details"].append({"id": file_id, "action": "skipped", "reason": "empty_url"})
                continue

            # ── Lock optimiste : status → processing ──────────────────────────
            updated = await conn.execute(
                """UPDATE pending_file_deletions
                   SET status='processing', last_attempt_at=$1,
                       attempt_count = attempt_count + 1
                   WHERE id=$2 AND status = ANY($3::text[])""",
                now, file_id, target_statuses
            )
            if updated == "UPDATE 0":
                # Déjà traité par une autre exécution concurrente
                result["skipped"] += 1
                result["details"].append({"id": file_id, "action": "skipped", "reason": "already_processing"})
                continue

            # ── Tentative de suppression ───────────────────────────────────────
            success, error_msg = await _delete_single_file(file_url)

            if success:
                await conn.execute(
                    """UPDATE pending_file_deletions
                       SET status='deleted', processed_at=$1, error_message=NULL
                       WHERE id=$2""",
                    now, file_id
                )
                result["deleted"] += 1
                result["details"].append({
                    "id":          file_id,
                    "file_url":    file_url,
                    "entity_type": row["entity_type"],
                    "entity_id":   row["entity_id"],
                    "action":      "deleted",
                })
            else:
                await conn.execute(
                    """UPDATE pending_file_deletions
                       SET status='failed', error_message=$1
                       WHERE id=$2""",
                    error_msg or "Erreur inconnue", file_id
                )
                result["failed"] += 1
                result["details"].append({
                    "id":          file_id,
                    "file_url":    file_url,
                    "entity_type": row["entity_type"],
                    "entity_id":   row["entity_id"],
                    "action":      "failed",
                    "error":       error_msg,
                })

    logger.info(
        f"[PURGE] retention={retention_days}j scanned={result['scanned']} "
        f"deleted={result['deleted']} failed={result['failed']} skipped={result['skipped']}"
    )
    return result


# ── CLI ───────────────────────────────────────────────────────────────────────

async def _cli_main():
    parser = argparse.ArgumentParser(
        description="Worker de purge différée des fichiers R2 orphelins (SpotU)"
    )
    parser.add_argument("--dry-run",        action="store_true",  help="Simuler sans supprimer")
    parser.add_argument("--retention-days", type=int,  default=30, help="Jours de rétention avant purge (défaut: 30)")
    parser.add_argument("--batch-size",     type=int,  default=100, help="Nombre max de fichiers par run (défaut: 100)")
    parser.add_argument("--retry-failed",   action="store_true",  help="Retenter les entrées en status=failed")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    # Charger .env
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

    from database import connect_to_db, get_pool, close_db
    await connect_to_db()
    pool = get_pool()

    mode = "DRY-RUN" if args.dry_run else "RÉEL"
    print(f"\n{'='*60}")
    print(f"  Worker Purge R2 — mode {mode}")
    print(f"  Rétention : {args.retention_days} jour(s)")
    print(f"  Batch max : {args.batch_size} fichiers")
    print(f"{'='*60}\n")

    result = await run_purge(
        pool,
        dry_run=args.dry_run,
        retention_days=args.retention_days,
        batch_size=args.batch_size,
        retry_failed=args.retry_failed,
    )

    await close_db()

    print(f"\n── Résultat ───────────────────────────────────────────")
    print(f"  Scannés   : {result['scanned']}")
    print(f"  Éligibles : {result['eligible']}")
    print(f"  Supprimés : {result['deleted']}")
    print(f"  Échecs    : {result['failed']}")
    print(f"  Ignorés   : {result['skipped']}")
    print(f"  Mode      : {'DRY-RUN (aucune suppression)' if result['dry_run'] else 'RÉEL'}")

    if result["details"]:
        print(f"\n── Détails ({len(result['details'])} entrées) ─────────────────────────")
        for d in result["details"][:20]:  # Afficher max 20 lignes en CLI
            action_label = {
                "deleted":                   "✓ SUPPRIMÉ",
                "failed":                    "✗ ÉCHEC   ",
                "skipped":                   "– IGNORÉ  ",
                "would_delete":              "~ PRÉVU   ",
                "would_skip_empty_url":      "~ VIDE    ",
                "would_skip":                "~ IGNORÉ  ",
            }.get(d.get("action", ""), "? INCONNU ")
            print(f"  {action_label} | {d.get('entity_type','?'):12} | {d.get('file_url','')[:60]}")
        if len(result["details"]) > 20:
            print(f"  ... et {len(result['details']) - 20} entrées supplémentaires")
    print()

    sys.exit(1 if result["failed"] > 0 else 0)


if __name__ == "__main__":
    asyncio.run(_cli_main())
