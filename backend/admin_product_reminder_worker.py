"""
admin_product_reminder_worker.py — Rappel 2h aux admins pour produits non traités.

Toutes les 10 minutes, vérifie s'il existe des produits en `pending_review`
depuis plus de 2 heures sans rappel envoyé (ou dont le dernier rappel
remonte à plus de 2h) et envoie une notification push à tous les admins.
"""
import asyncio
import logging
from datetime import timezone, datetime

log = logging.getLogger("admin_product_reminder")

REMINDER_INTERVAL_SECS = 600   # vérification toutes les 10 minutes
REMINDER_DELAY_HOURS   = 2     # délai avant premier rappel


async def send_pending_reminders(pool) -> int:
    """
    Détecte les produits pending depuis 2h+ sans rappel récent,
    met à jour admin_reminder_sent_at, et pousse les notifs aux admins.
    Retourne le nombre de produits traités.
    """
    from push_service import send_push_to_user

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT product_id, title
            FROM marketplace_products
            WHERE status = 'pending_review'
              AND created_at < NOW() - INTERVAL '{REMINDER_DELAY_HOURS} hours'
              AND (
                    admin_reminder_sent_at IS NULL
                 OR admin_reminder_sent_at < NOW() - INTERVAL '{REMINDER_DELAY_HOURS} hours'
              )
            ORDER BY created_at ASC
            LIMIT 50
            """
        )
        if not rows:
            return 0

        admin_ids = [
            r["user_id"]
            for r in await conn.fetch("SELECT user_id FROM users WHERE role = 'admin'")
        ]

        if not admin_ids:
            return 0

        now = datetime.now(timezone.utc)
        product_ids = [r["product_id"] for r in rows]
        await conn.execute(
            "UPDATE marketplace_products SET admin_reminder_sent_at = $1 WHERE product_id = ANY($2::text[])",
            now, product_ids,
        )

    count = len(rows)
    for product in rows:
        for admin_id in admin_ids:
            await send_push_to_user(
                pool,
                admin_id,
                title="Rappel : annonce en attente",
                body=f"L'annonce « {product['title']} » attend votre validation depuis {REMINDER_DELAY_HOURS}h.",
                data={
                    "type": "admin_product_reminder",
                    "product_id": product["product_id"],
                    "action": "/admin?tab=products",
                },
                notif_type="admin_product_reminder",
            )

    log.info("AdminProductReminderWorker: %d rappel(s) envoyé(s).", count)
    return count


class AdminProductReminderWorker:
    def __init__(self, pool, interval_secs: int = REMINDER_INTERVAL_SECS):
        self._pool     = pool
        self._interval = interval_secs
        self._task     = None

    def start(self):
        self._task = asyncio.ensure_future(self._run())
        log.info("AdminProductReminderWorker démarré (interval=%ds)", self._interval)

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self):
        while True:
            try:
                await send_pending_reminders(self._pool)
            except Exception as exc:
                log.error("AdminProductReminderWorker erreur: %s", exc)
            await asyncio.sleep(self._interval)
