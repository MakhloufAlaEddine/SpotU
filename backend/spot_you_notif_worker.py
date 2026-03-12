"""
spot_you_notif_worker.py — Worker de notifications SpotYou
===========================================================

Envoie deux types de notifications :
  1. Après la fin d'une séance : "Réserve ta place pour la prochaine séance"
     → Notifie TOUS les membres de la communauté qui n'étaient PAS inscrits
       à la séance qui vient de se terminer.
  2. 3h avant la prochaine séance (si capacité non atteinte) :
     → Notifie les membres NON encore inscrits à la prochaine séance.

Le worker tourne toutes les 15 minutes et évite les doublons en vérifiant
si une notification du même type a déjà été envoyée pour ce point + session_date.
"""
import asyncio
import logging
import json as _json
from datetime import datetime, timezone, timedelta, date as date_type, time as time_type
from typing import Optional

from models import new_id
from routes.spot_you_routes import get_next_session_date

log = logging.getLogger("spot_you_notif_worker")

WORKER_INTERVAL_SECS = 900   # 15 minutes
# Fenêtre post-session : on notifie si la séance a fini entre maintenant et 20 min en arrière
POST_SESSION_WINDOW_MIN = 20
# Fenêtre pré-session : on notifie si la séance commence dans 2h45 → 3h15
PRE_SESSION_LOW_MIN  = 165   # 2h45
PRE_SESSION_HIGH_MIN = 195   # 3h15


def _get_session_times(point: dict) -> list[tuple[date_type, time_type, Optional[time_type]]]:
    """
    Retourne la liste des (session_date, start_time, end_time) des sessions
    sur les 30 prochains jours.
    Convention jours : 0=Lun … 6=Dim.
    """
    now = datetime.now(timezone.utc)
    today = now.date()
    results = []

    event_schedule = point.get("event_schedule")
    event_date = point.get("event_date")
    event_end_date = point.get("event_end_date")

    if event_schedule:
        sched = event_schedule
        if isinstance(sched, str):
            try:
                sched = _json.loads(sched)
            except Exception:
                return []

        if not isinstance(sched, dict) or sched.get("type") != "weekly":
            return []

        schedule = sched.get("schedule", {})
        range_end = today + timedelta(days=30)
        cursor = today
        while cursor <= range_end:
            day_str = str(cursor.weekday())  # 0=Lun..6=Dim
            if day_str in schedule and schedule[day_str]:
                for slot in schedule[day_str]:
                    if isinstance(slot, str):
                        start_str, end_str = slot, None
                    elif isinstance(slot, dict):
                        start_str = slot.get("start", "")
                        end_str = slot.get("end")
                    else:
                        continue
                    try:
                        sh, sm = map(int, start_str.split(":"))
                        start_t = time_type(sh, sm)
                    except (ValueError, TypeError):
                        continue
                    end_t = None
                    if end_str:
                        try:
                            eh, em = map(int, end_str.split(":"))
                            end_t = time_type(eh, em)
                        except (ValueError, TypeError):
                            pass
                    results.append((cursor, start_t, end_t))
            cursor += timedelta(days=1)

    elif event_date:
        if isinstance(event_date, str):
            try:
                from dateutil.parser import parse as _parse
                event_date = _parse(event_date)
            except Exception:
                return []
        if hasattr(event_date, "date"):
            d = event_date.date()
            start_t = event_date.timetz() if event_date.tzinfo else time_type(event_date.hour, event_date.minute)
        else:
            return []
        end_t = None
        if event_end_date:
            if isinstance(event_end_date, str):
                try:
                    from dateutil.parser import parse as _parse2
                    event_end_date = _parse2(event_end_date)
                except Exception:
                    event_end_date = None
            if event_end_date and hasattr(event_end_date, "time"):
                end_t = event_end_date.time()
        if d >= today:
            results.append((d, start_t, end_t))

    return results


async def _has_notif_already_sent(conn, point_id: str, session_date: date_type, notif_type: str) -> bool:
    """Vérifie si une notification de ce type a déjà été envoyée pour ce point + session_date."""
    date_str = session_date.isoformat()
    row = await conn.fetchrow(
        """SELECT notif_id FROM notifications
           WHERE type = $1
             AND data->>'point_id' = $2
             AND data->>'session_date' = $3
           LIMIT 1""",
        notif_type, point_id, date_str,
    )
    return row is not None


async def _insert_notif(conn, user_id: str, notif_type: str, title: str, body: str, data: dict):
    """Insère une notification en base."""
    await conn.execute(
        """INSERT INTO notifications (notif_id, user_id, type, title, body, data)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        new_id("ntf"), user_id, notif_type, title, body, _json.dumps(data),
    )


async def process_spot_you_notifications(pool) -> int:
    """
    Traite les notifications SpotYou pour toutes les séances actives.
    Retourne le nombre de notifications envoyées.
    """
    total_sent = 0
    now = datetime.now(timezone.utc)

    async with pool.acquire() as conn:
        points = await conn.fetch(
            """SELECT point_id, title, user_id, event_date, event_end_date,
                      event_schedule, maximum_participants
               FROM tag_points
               WHERE active = TRUE AND (cancelled = FALSE OR cancelled IS NULL)
                 AND (event_date IS NOT NULL OR event_schedule IS NOT NULL)"""
        )

        for point_row in points:
            point = dict(point_row)
            point_id = point["point_id"]
            title = point.get("title", "SpotYou")
            max_p = point.get("maximum_participants")

            sessions = _get_session_times(point)

            for session_date, start_t, end_t in sessions:
                session_start_dt = datetime.combine(session_date, start_t).replace(tzinfo=timezone.utc)

                # ── Notification 3h avant la séance ─────────────────────────
                mins_until = (session_start_dt - now).total_seconds() / 60
                if PRE_SESSION_LOW_MIN <= mins_until <= PRE_SESSION_HIGH_MIN:
                    # Vérifier si déjà envoyé
                    already = await _has_notif_already_sent(conn, point_id, session_date, "spotyu_reminder")
                    if not already:
                        # Vérifier capacité
                        going_count = await conn.fetchval(
                            """SELECT COUNT(*) FROM spot_you_attendance
                               WHERE spot_you_id = $1 AND session_date = $2 AND status = 'going'""",
                            point_id, session_date,
                        )
                        if max_p is None or int(going_count) < max_p:
                            # Récupérer membres pas encore inscrits
                            members = await conn.fetch(
                                """SELECT p.user_id FROM spot_you_members p
                                   WHERE p.spot_you_id = $1
                                     AND NOT EXISTS (
                                       SELECT 1 FROM spot_you_attendance a
                                       WHERE a.spot_you_id = p.spot_you_id
                                         AND a.user_id = p.user_id
                                         AND a.session_date = $2
                                         AND a.status = 'going'
                                     )""",
                                point_id, session_date,
                            )
                            date_display = session_date.strftime("%d/%m")
                            data = {
                                "type": "spotyu_reminder",
                                "point_id": point_id,
                                "session_date": session_date.isoformat(),
                            }
                            for m in members:
                                await _insert_notif(
                                    conn, m["user_id"],
                                    "spotyu_reminder",
                                    f"Séance demain – {title}",
                                    f"Tu viens le {date_display} à {start_t.strftime('%H:%M')} ? Il reste de la place !",
                                    data,
                                )
                                total_sent += 1

                # ── Notification après la fin de la séance ──────────────────
                if end_t:
                    session_end_dt = datetime.combine(session_date, end_t).replace(tzinfo=timezone.utc)
                    mins_since_end = (now - session_end_dt).total_seconds() / 60
                    if 0 <= mins_since_end <= POST_SESSION_WINDOW_MIN:
                        already = await _has_notif_already_sent(conn, point_id, session_date, "spotyu_post_session")
                        if not already:
                            # Calcul prochaine séance
                            next_date = get_next_session_date(point)
                            # Notifier tous les membres de la communauté
                            members = await conn.fetch(
                                "SELECT user_id FROM spot_you_members WHERE spot_you_id = $1",
                                point_id,
                            )
                            data = {
                                "type": "spotyu_post_session",
                                "point_id": point_id,
                                "session_date": session_date.isoformat(),
                            }
                            next_info = f" le {next_date.strftime('%d/%m')}" if next_date else ""
                            for m in members:
                                await _insert_notif(
                                    conn, m["user_id"],
                                    "spotyu_post_session",
                                    title,
                                    f"Réserve ta place pour la prochaine séance de {title}{next_info} !",
                                    data,
                                )
                                total_sent += 1

    return total_sent


class SpotYouNotifWorker:
    """Worker de notifications SpotYou tournant en arrière-plan."""

    def __init__(self, pool, interval_secs: int = WORKER_INTERVAL_SECS):
        self._pool = pool
        self._interval = interval_secs
        self._task: asyncio.Task | None = None

    def start(self):
        self._task = asyncio.create_task(self._run(), name="spotyou_notif_worker")
        log.info("SpotYouNotifWorker démarré (intervalle=%ds)", self._interval)

    async def stop(self):
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        log.info("SpotYouNotifWorker arrêté")

    async def _run(self):
        await asyncio.sleep(60)   # Délai initial pour laisser le serveur démarrer
        while True:
            await self._tick()
            await asyncio.sleep(self._interval)

    async def _tick(self):
        try:
            n = await process_spot_you_notifications(self._pool)
            if n:
                log.info("SpotYouNotifWorker : %d notification(s) envoyée(s)", n)
        except Exception as exc:
            log.exception("SpotYouNotifWorker : erreur : %s", exc)
