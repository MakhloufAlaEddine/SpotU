"""
MediaPurgeWorker — Phase C, worker 1/2

Rôle :
  À J+90 exactement (media_purge_scheduled_at <= NOW()), marquer toutes les entités
  soft-deleted comme `media_purged=TRUE` et lancer la purge physique des fichiers
  via admin_purge_worker.run_purge(pool, retention_days=0).

  Idempotence stricte :
    - Skip si `reactivated_at IS NOT NULL AND reactivated_at >= deleted_at`
    - Skip si `media_purged = TRUE` (déjà traitée)
    - Utilise ON CONFLICT DO NOTHING pour pending_file_deletions

  Démarrage : worker asyncio cadencé toutes les INTERVAL_SECS secondes.
"""

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger("media_purge_worker")

INTERVAL_SECS = 3600  # toutes les heures


class MediaPurgeWorker:
    def __init__(self, pool, interval_secs: int = INTERVAL_SECS):
        self._pool = pool
        self._interval = interval_secs
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    def start(self):
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="media_purge_worker")
        logger.info("MediaPurgeWorker démarré (intervalle=%ds)", self._interval)

    async def stop(self):
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("MediaPurgeWorker arrêté")

    async def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                result = await run_media_purge(self._pool)
                if result["purged"] > 0:
                    logger.info(
                        "[PURGE-MEDIA] %d entité(s) purgée(s) — tag_points:%d services:%d products:%d users:%d",
                        result["purged"],
                        result.get("tag_points", 0),
                        result.get("services", 0),
                        result.get("products", 0),
                        result.get("users", 0),
                    )
            except Exception as exc:
                logger.error("[PURGE-MEDIA] Erreur cycle : %s", exc, exc_info=True)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass


async def run_media_purge(pool) -> dict:
    """
    Scan toutes les entités dont media_purge_scheduled_at <= NOW() et media_purged=FALSE.
    Pour chacune :
      1. Vérifie qu'elle est encore supprimée (pas réactivée).
      2. Marque media_purged=TRUE et media_purged_at=NOW().
    Ensuite déclenche admin_purge_worker.run_purge(pool, retention_days=0)
    pour traiter les entrées de pending_file_deletions dont scheduled_at est passé.

    Retourne un dictionnaire de compteurs.
    """
    now = datetime.now(timezone.utc)
    counts = {"purged": 0, "tag_points": 0, "services": 0, "products": 0, "users": 0}

    # Définition des tables à scanner
    # (table, id_col, deleted_check)
    entity_specs = [
        ("tag_points",          "point_id",   "deleted_at IS NOT NULL AND active=FALSE"),
        ("services",            "service_id", "deleted_at IS NOT NULL AND active=FALSE"),
        ("marketplace_products","product_id", "deleted_at IS NOT NULL AND status='deleted'"),
        ("users",               "user_id",    "deleted_at IS NOT NULL"),
    ]

    stat_keys = ["tag_points", "services", "products", "users"]

    async with pool.acquire() as conn:
        for (table, id_col, del_check), stat_key in zip(entity_specs, stat_keys):
            rows = await conn.fetch(
                f"""SELECT {id_col}
                    FROM {table}
                    WHERE media_purge_scheduled_at <= $1
                      AND media_purged = FALSE
                      AND {del_check}
                      AND (reactivated_at IS NULL OR reactivated_at < deleted_at)""",
                now
            )
            if not rows:
                continue

            ids = [r[id_col] for r in rows]
            await conn.execute(
                f"""UPDATE {table}
                    SET media_purged=TRUE, media_purged_at=$1
                    WHERE {id_col}=ANY($2::text[])""",
                now, ids
            )
            counts[stat_key] = len(ids)
            counts["purged"] += len(ids)

    # Déclencher la purge physique des fichiers déjà schedulés
    if counts["purged"] > 0:
        try:
            from admin_purge_worker import run_purge
            await run_purge(pool, retention_days=0, batch_size=500, dry_run=False)
        except Exception as exc:
            logger.warning("[PURGE-MEDIA] run_purge() a échoué : %s", exc)

    return counts
