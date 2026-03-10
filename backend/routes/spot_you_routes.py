"""
spot_you_routes.py — Routes de participation SpotYou
=====================================================

Gère :
  - Rejoindre une communauté SpotYou (spot_you_participants)
  - Indiquer sa présence à la prochaine séance (spot_you_attendance)
  - Lister les membres et les présents à la prochaine séance
"""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta, date as date_type
from typing import Optional
from auth_utils import require_auth
from database import get_pool, rows_to_list
from models import new_id
import json as _json
import logging

router = APIRouter()
log = logging.getLogger(__name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_next_session_date(point: dict) -> Optional[date_type]:
    """
    Calcule la prochaine date de séance d'un SpotYou.
    Retourne None si aucune séance future n'est définie.
    Convention jours : 0=Lun … 6=Dim (identique au frontend).
    """
    now = datetime.now(timezone.utc)
    today = now.date()

    event_schedule = point.get("event_schedule")
    event_date = point.get("event_date")

    # Préférer event_schedule (récurrent) sur event_date (ponctuel)
    if event_schedule:
        sched = event_schedule
        if isinstance(sched, str):
            try:
                sched = _json.loads(sched)
            except Exception:
                return None

        if not isinstance(sched, dict) or sched.get("type") != "weekly":
            return None

        schedule = sched.get("schedule", {})
        if not schedule:
            return None

        # Python weekday : 0=Lun … 6=Dim — même convention que le frontend
        today_weekday = today.weekday()

        earliest: Optional[date_type] = None
        for day_str, slots in schedule.items():
            day_idx = int(day_str)
            if not slots:
                continue

            # Obtenir l'heure de début du premier créneau
            first_slot = slots[0] if isinstance(slots, list) else {}
            if isinstance(first_slot, str):
                start_time_str = first_slot
            elif isinstance(first_slot, dict) and "start" in first_slot:
                start_time_str = first_slot["start"]
            else:
                continue

            try:
                h, m = map(int, start_time_str.split(":"))
            except ValueError:
                continue

            days_until = (day_idx - today_weekday) % 7
            if days_until == 0:
                # Aujourd'hui : vérifier si l'heure est déjà passée
                session_time = now.replace(hour=h, minute=m, second=0, microsecond=0)
                if now >= session_time:
                    days_until = 7

            candidate = today + timedelta(days=days_until)
            if earliest is None or candidate < earliest:
                earliest = candidate

        return earliest

    if event_date:
        # Événement ponctuel
        if isinstance(event_date, str):
            try:
                from dateutil.parser import parse as _parse
                event_date = _parse(event_date)
            except Exception:
                return None
        if hasattr(event_date, "date"):
            d = event_date.date()
        else:
            d = event_date
        return d if d >= today else None

    return None


def apply_capacity_defaults(minimum: Optional[int], maximum: Optional[int]):
    """
    Applique les règles métier de capacité :
    - Si max défini mais pas min → min = max
    - Si min défini mais pas max → max = min
    """
    if minimum is not None and maximum is None:
        maximum = minimum
    elif maximum is not None and minimum is None:
        minimum = maximum
    if minimum is not None and maximum is not None:
        if minimum < 1:
            minimum = 1
        if maximum < minimum:
            maximum = minimum
    return minimum, maximum


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/spot-you/{point_id}/join")
async def join_spot_you(point_id: str, request: Request):
    """
    Rejoindre la communauté d'un SpotYou.
    Idempotent : si déjà membre, ne fait rien.
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        point = await conn.fetchrow(
            "SELECT point_id, user_id, title FROM tag_points WHERE point_id = $1 AND active = TRUE",
            point_id,
        )
        if not point:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")

        sid = new_id("syp")
        await conn.execute(
            """INSERT INTO spot_you_participants (id, spot_you_id, user_id)
               VALUES ($1, $2, $3) ON CONFLICT (spot_you_id, user_id) DO NOTHING""",
            sid, point_id, user["user_id"],
        )
        # Compatibilité rétrograde : mise à jour de tag_point_participants pour le planning
        tpp_id = new_id("part")
        await conn.execute(
            """INSERT INTO tag_point_participants (participant_id, point_id, user_id)
               VALUES ($1, $2, $3) ON CONFLICT (point_id, user_id) DO NOTHING""",
            tpp_id, point_id, user["user_id"],
        )

        count = await conn.fetchval(
            "SELECT COUNT(*) FROM spot_you_participants WHERE spot_you_id = $1", point_id
        )

    # Notifier le créateur (si différent)
    if point["user_id"] != user["user_id"]:
        try:
            from push_service import send_push_to_user
            import asyncio
            title_str = point["title"] or "SpotYou"
            asyncio.create_task(send_push_to_user(
                pool, point["user_id"],
                title="Nouveau membre",
                body=f'{user["name"]} a rejoint votre communauté «{title_str}»',
                data={
                    "type": "spotyu_join", "point_id": point_id,
                    "sender_id": user["user_id"], "sender_name": user.get("name", ""),
                    "sender_picture": user.get("picture") or "",
                    "action_text": "a rejoint votre SpotYou",
                    "content_title": title_str,
                },
                notif_type="spotyu_join",
            ))
        except Exception:
            pass

    return {"success": True, "participants_count": int(count), "is_member": True}


@router.delete("/spot-you/{point_id}/leave")
async def leave_spot_you(point_id: str, request: Request):
    """Quitter la communauté d'un SpotYou."""
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM spot_you_participants WHERE spot_you_id = $1 AND user_id = $2",
            point_id, user["user_id"],
        )
        await conn.execute(
            "DELETE FROM tag_point_participants WHERE point_id = $1 AND user_id = $2",
            point_id, user["user_id"],
        )
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM spot_you_participants WHERE spot_you_id = $1", point_id
        )

    return {"success": True, "participants_count": int(count), "is_member": False}


@router.post("/spot-you/{point_id}/going")
async def going_spot_you(point_id: str, request: Request):
    """
    Indiquer sa présence à la prochaine séance.
    Auto-rejoint la communauté si pas encore membre.
    Vérifie la capacité maximale.
    """
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        point = await conn.fetchrow(
            """SELECT point_id, user_id, title, event_date, event_schedule,
                      minimum_participants, maximum_participants
               FROM tag_points WHERE point_id = $1 AND active = TRUE""",
            point_id,
        )
        if not point:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")

        point_dict = dict(point)
        next_date = get_next_session_date(point_dict)
        if not next_date:
            raise HTTPException(status_code=400, detail="Pas de prochaine séance trouvée")

        max_p = point_dict.get("maximum_participants")

        # Vérifier la capacité
        if max_p is not None:
            going_count = await conn.fetchval(
                """SELECT COUNT(*) FROM spot_you_attendance
                   WHERE spot_you_id = $1 AND session_date = $2 AND status = 'going'""",
                point_id, next_date,
            )
            if going_count >= max_p:
                raise HTTPException(
                    status_code=400,
                    detail="Capacité maximale atteinte pour cette séance",
                )

        # Auto-rejoindre la communauté si pas encore membre
        sid = new_id("syp")
        await conn.execute(
            """INSERT INTO spot_you_participants (id, spot_you_id, user_id)
               VALUES ($1, $2, $3) ON CONFLICT (spot_you_id, user_id) DO NOTHING""",
            sid, point_id, user["user_id"],
        )
        tpp_id = new_id("part")
        await conn.execute(
            """INSERT INTO tag_point_participants (participant_id, point_id, user_id)
               VALUES ($1, $2, $3) ON CONFLICT (point_id, user_id) DO NOTHING""",
            tpp_id, point_id, user["user_id"],
        )

        # Upsert de la présence
        att_id = new_id("att")
        await conn.execute(
            """INSERT INTO spot_you_attendance (id, spot_you_id, user_id, session_date, status)
               VALUES ($1, $2, $3, $4, 'going')
               ON CONFLICT (spot_you_id, user_id, session_date)
               DO UPDATE SET status = 'going'""",
            att_id, point_id, user["user_id"], next_date,
        )

        going_count = await conn.fetchval(
            """SELECT COUNT(*) FROM spot_you_attendance
               WHERE spot_you_id = $1 AND session_date = $2 AND status = 'going'""",
            point_id, next_date,
        )
        members_count = await conn.fetchval(
            "SELECT COUNT(*) FROM spot_you_participants WHERE spot_you_id = $1", point_id
        )
        is_full = max_p is not None and going_count >= max_p

    return {
        "success": True,
        "is_going": True,
        "is_member": True,
        "going_count": int(going_count),
        "participants_count": int(members_count),
        "session_date": next_date.isoformat(),
        "is_full": is_full,
    }


@router.delete("/spot-you/{point_id}/going")
async def not_going_spot_you(point_id: str, request: Request):
    """Retirer sa présence à la prochaine séance."""
    pool = get_pool()
    user = await require_auth(request, pool)

    async with pool.acquire() as conn:
        point = await conn.fetchrow(
            "SELECT event_date, event_schedule, maximum_participants FROM tag_points WHERE point_id = $1 AND active = TRUE",
            point_id,
        )
        if not point:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")

        next_date = get_next_session_date(dict(point))
        if next_date:
            await conn.execute(
                """DELETE FROM spot_you_attendance
                   WHERE spot_you_id = $1 AND user_id = $2 AND session_date = $3""",
                point_id, user["user_id"], next_date,
            )

        going_count = await conn.fetchval(
            """SELECT COUNT(*) FROM spot_you_attendance
               WHERE spot_you_id = $1 AND session_date = $2 AND status = 'going'""",
            point_id, next_date,
        ) if next_date else 0

        max_p = point["maximum_participants"]
        is_full = max_p is not None and (going_count or 0) >= max_p

    return {
        "success": True,
        "is_going": False,
        "going_count": int(going_count or 0),
        "is_full": is_full,
        "session_date": next_date.isoformat() if next_date else None,
    }


@router.get("/spot-you/{point_id}/activity")
async def get_spot_you_activity(point_id: str, request: Request):
    """
    Fil d'activité d'un SpotYou pour ses membres :
    - "Thomas vient samedi"   → going avec session_date >= today
    - "Marie a rejoint"       → joins des 30 derniers jours

    Règles d'affichage :
    - Les "vient [jour]" ne sont affichés QUE si la session est dans le futur (>= today)
    - Les "a rejoint" ne sont affichés que sur les 30 derniers jours
    - Résultat trié par timestamp DESC, max 30 items
    """
    pool = get_pool()

    async with pool.acquire() as conn:
        point = await conn.fetchrow(
            "SELECT point_id, event_date, event_schedule FROM tag_points WHERE point_id = $1 AND active = TRUE",
            point_id,
        )
        if not point:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")

        from datetime import date as date_type
        now = datetime.now(timezone.utc)
        today = now.date()
        cutoff_joins = now - timedelta(days=30)

        DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

        activities = []

        # ── Présences à venir ─────────────────────────────────────────────────
        going_rows = await conn.fetch(
            """SELECT a.user_id, a.session_date, a.created_at,
                      u.name, u.picture
               FROM spot_you_attendance a
               JOIN users u ON a.user_id = u.user_id
               WHERE a.spot_you_id = $1
                 AND a.status = 'going'
                 AND a.session_date >= $2
               ORDER BY a.created_at DESC
               LIMIT 50""",
            point_id, today,
        )

        for row in going_rows:
            session_date: date_type = row["session_date"]
            days_diff = (session_date - today).days
            if days_diff == 0:
                day_label = "aujourd'hui"
            elif days_diff == 1:
                day_label = "demain"
            else:
                day_label = DAY_NAMES[session_date.weekday()]

            activities.append({
                "type": "going",
                "user_id": row["user_id"],
                "name": row["name"],
                "picture": row["picture"],
                "action_text": f"vient {day_label}",
                "session_date": session_date.isoformat(),
                "timestamp": row["created_at"].isoformat(),
            })

        # ── Membres récents (30 derniers jours) ───────────────────────────────
        join_rows = await conn.fetch(
            """SELECT p.user_id, p.joined_at,
                      u.name, u.picture
               FROM spot_you_participants p
               JOIN users u ON p.user_id = u.user_id
               WHERE p.spot_you_id = $1
                 AND p.joined_at >= $2
               ORDER BY p.joined_at DESC
               LIMIT 50""",
            point_id, cutoff_joins,
        )

        for row in join_rows:
            activities.append({
                "type": "joined",
                "user_id": row["user_id"],
                "name": row["name"],
                "picture": row["picture"],
                "action_text": "a rejoint la communauté",
                "session_date": None,
                "timestamp": row["joined_at"].isoformat(),
            })

        # Déduplique par (user_id, type) pour éviter doublons visuels
        seen: set[tuple] = set()
        unique: list[dict] = []
        for a in activities:
            key = (a["user_id"], a["type"], a.get("session_date"))
            if key not in seen:
                seen.add(key)
                unique.append(a)

        # Trier par timestamp DESC
        unique.sort(key=lambda x: x["timestamp"], reverse=True)

    return {"activities": unique[:30]}


async def get_spot_you_members(point_id: str):
    """Liste les membres de la communauté SpotYou."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT u.user_id, u.name, u.picture, u.role,
                      p.joined_at,
                      (u.user_id = tp.user_id) as is_creator
               FROM spot_you_participants p
               JOIN users u ON p.user_id = u.user_id
               JOIN tag_points tp ON tp.point_id = p.spot_you_id
               WHERE p.spot_you_id = $1
               ORDER BY (u.user_id = tp.user_id) DESC, p.joined_at ASC""",
            point_id,
        )
    return [
        {
            "user_id": r["user_id"],
            "name": r["name"],
            "picture": r["picture"],
            "role": r["role"],
            "is_creator": r["is_creator"],
            "joined_at": r["joined_at"].isoformat() if r["joined_at"] else None,
        }
        for r in rows
    ]


@router.get("/spot-you/{point_id}/going")
async def get_spot_you_going(point_id: str):
    """Liste les utilisateurs présents à la prochaine séance."""
    pool = get_pool()
    async with pool.acquire() as conn:
        point = await conn.fetchrow(
            "SELECT event_date, event_schedule FROM tag_points WHERE point_id = $1 AND active = TRUE",
            point_id,
        )
        if not point:
            raise HTTPException(status_code=404, detail="SpotYou introuvable")

        next_date = get_next_session_date(dict(point))
        if not next_date:
            return {"session_date": None, "going": []}

        rows = await conn.fetch(
            """SELECT u.user_id, u.name, u.picture, u.role,
                      a.created_at as registered_at
               FROM spot_you_attendance a
               JOIN users u ON a.user_id = u.user_id
               WHERE a.spot_you_id = $1
                 AND a.session_date = $2
                 AND a.status = 'going'
               ORDER BY a.created_at ASC""",
            point_id, next_date,
        )

    return {
        "session_date": next_date.isoformat(),
        "going": [
            {
                "user_id": r["user_id"],
                "name": r["name"],
                "picture": r["picture"],
                "role": r["role"],
                "registered_at": r["registered_at"].isoformat() if r["registered_at"] else None,
            }
            for r in rows
        ],
    }
