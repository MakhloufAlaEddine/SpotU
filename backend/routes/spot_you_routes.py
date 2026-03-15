"""
spot_you_routes.py — Routes de participation SpotYou
=====================================================

Gère :
  - Rejoindre une communauté SpotYou (spot_you_members)
  - Indiquer sa présence à la prochaine séance (spot_you_attendance)
  - Lister les membres et les présents à la prochaine séance
"""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone, timedelta, date as date_type
from typing import Optional
from auth_utils import require_auth
from database import get_pool, rows_to_list
from models import new_id
import asyncio
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
    Utilise le fuseau Paris (Europe/Paris) pour les comparaisons d'heures,
    car les heures du schedule sont exprimées en heure locale Paris.
    """
    from zoneinfo import ZoneInfo
    paris = ZoneInfo('Europe/Paris')
    now_paris = datetime.now(paris)
    today = now_paris.date()          # date locale Paris

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
                # Aujourd'hui : comparer en heure de Paris (les heures du schedule sont en heure locale)
                session_time = now_paris.replace(hour=h, minute=m, second=0, microsecond=0)
                if now_paris >= session_time:
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
    Exécuté dans une transaction pour la cohérence.
    """
    from chat_manager import spotyou_manager
    pool = get_pool()
    user = await require_auth(request, pool)

    count = 0
    point = None
    async with pool.acquire() as conn:
        async with conn.transaction():
            point = await conn.fetchrow(
                "SELECT point_id, user_id, title FROM tag_points WHERE point_id = $1 AND active = TRUE",
                point_id,
            )
            if not point:
                raise HTTPException(status_code=404, detail="SpotYou introuvable")

            sid = new_id("syp")
            await conn.execute(
                """INSERT INTO spot_you_members (id, spot_you_id, user_id)
                   VALUES ($1, $2, $3) ON CONFLICT (spot_you_id, user_id) DO NOTHING""",
                sid, point_id, user["user_id"],
            )

            count = await conn.fetchval(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = $1", point_id
            )

            # Auto-ajouter l'utilisateur dans la conversation de groupe si elle existe
            group_conv = await conn.fetchrow(
                "SELECT conversation_id FROM conversations WHERE type='tagpoint_group' AND context_id=$1",
                point_id,
            )
            if group_conv:
                conv_id = group_conv["conversation_id"]
                await conn.execute(
                    """INSERT INTO conversation_participants (conversation_id, user_id, status)
                       VALUES ($1, $2, 'active')
                       ON CONFLICT (conversation_id, user_id)
                       DO UPDATE SET status = 'active'""",
                    conv_id, user["user_id"],
                )

    # Broadcast temps réel après commit de la transaction
    asyncio.create_task(spotyou_manager.broadcast(point_id, {
        "type": "spotyou_update",
        "point_id": point_id,
        "participants_count": int(count),
    }))

    # Notifier le créateur (si différent)
    if point and point["user_id"] != user["user_id"]:
        try:
            from push_service import send_push_to_user
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
    """Quitter la communauté d'un SpotYou. Exécuté dans une transaction."""
    from chat_manager import spotyou_manager
    pool = get_pool()
    user = await require_auth(request, pool)

    count = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Le propriétaire ne peut pas quitter sa propre communauté
            owner_id = await conn.fetchval(
                "SELECT user_id FROM tag_points WHERE point_id = $1", point_id
            )
            if owner_id and str(owner_id) == str(user["user_id"]):
                raise HTTPException(status_code=403, detail="Le propriétaire ne peut pas quitter sa propre communauté.")

            await conn.execute(
                "DELETE FROM spot_you_members WHERE spot_you_id = $1 AND user_id = $2",
                point_id, user["user_id"],
            )

            # Annuler les participations futures aux séances
            await conn.execute(
                """DELETE FROM spot_you_attendance
                   WHERE spot_you_id = $1 AND user_id = $2
                     AND session_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date""",
                point_id, user["user_id"],
            )

            count = await conn.fetchval(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = $1", point_id
            )

            # Bloquer l'utilisateur dans la conversation de groupe (sans le supprimer)
            group_conv = await conn.fetchrow(
                "SELECT conversation_id FROM conversations WHERE type='tagpoint_group' AND context_id=$1",
                point_id,
            )
            if group_conv:
                await conn.execute(
                    """UPDATE conversation_participants
                       SET status = 'blocked'
                       WHERE conversation_id = $1 AND user_id = $2""",
                    group_conv["conversation_id"], user["user_id"],
                )

    # Broadcast temps réel après commit
    asyncio.create_task(spotyou_manager.broadcast(point_id, {
        "type": "spotyou_update",
        "point_id": point_id,
        "participants_count": int(count),
    }))

    return {"success": True, "participants_count": int(count), "is_member": False}


@router.post("/spot-you/{point_id}/going")
async def going_spot_you(point_id: str, request: Request):
    """
    Indiquer sa présence à la prochaine séance.
    Utilise SELECT FOR UPDATE pour éviter les race conditions de capacité.
    Transaction atomique : vérification capacité + insertion en un seul bloc.
    """
    from chat_manager import spotyou_manager
    pool = get_pool()
    user = await require_auth(request, pool)

    going_count_final = 0
    members_count_final = 0
    is_full_final = False
    next_date_final = None

    async with pool.acquire() as conn:
        async with conn.transaction():
            # Verrouiller la ligne tag_points pour éviter les race conditions de capacité
            point = await conn.fetchrow(
                """SELECT point_id, user_id, title, event_date, event_schedule,
                          minimum_participants, maximum_participants
                   FROM tag_points WHERE point_id = $1 AND active = TRUE
                   FOR UPDATE""",
                point_id,
            )
            if not point:
                raise HTTPException(status_code=404, detail="SpotYou introuvable")

            # Règle métier : l'utilisateur doit être membre pour participer à une séance
            is_member = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM spot_you_members WHERE spot_you_id=$1 AND user_id=$2)",
                point_id, user["user_id"],
            )
            if not is_member:
                raise HTTPException(
                    status_code=403,
                    detail="Vous devez rejoindre ce SpotYou avant de pouvoir participer à une séance",
                )

            point_dict = dict(point)
            next_date = get_next_session_date(point_dict)
            if not next_date:
                raise HTTPException(status_code=400, detail="Pas de prochaine séance trouvée")

            max_p = point_dict.get("maximum_participants")

            # Vérifier la capacité — au sein de la transaction (cohérent avec le verrou FOR UPDATE)
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

            # Upsert de la présence
            att_id = new_id("att")
            await conn.execute(
                """INSERT INTO spot_you_attendance (id, spot_you_id, user_id, session_date, status)
                   VALUES ($1, $2, $3, $4, 'going')
                   ON CONFLICT (spot_you_id, user_id, session_date)
                   DO UPDATE SET status = 'going'""",
                att_id, point_id, user["user_id"], next_date,
            )

            going_count_final = await conn.fetchval(
                """SELECT COUNT(*) FROM spot_you_attendance
                   WHERE spot_you_id = $1 AND session_date = $2 AND status = 'going'""",
                point_id, next_date,
            )
            members_count_final = await conn.fetchval(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = $1", point_id
            )
            is_full_final = max_p is not None and going_count_final >= max_p
            next_date_final = next_date

    # Broadcast temps réel après commit de la transaction
    asyncio.create_task(spotyou_manager.broadcast(point_id, {
        "type": "spotyou_update",
        "point_id": point_id,
        "going_count": int(going_count_final),
        "participants_count": int(members_count_final),
        "is_full": is_full_final,
        "session_date": next_date_final.isoformat() if next_date_final else None,
    }))

    return {
        "success": True,
        "is_going": True,
        "is_member": True,
        "going_count": int(going_count_final),
        "participants_count": int(members_count_final),
        "session_date": next_date_final.isoformat() if next_date_final else None,
        "is_full": is_full_final,
    }


@router.delete("/spot-you/{point_id}/going")
async def not_going_spot_you(point_id: str, request: Request):
    """Retirer sa présence à la prochaine séance. Transaction + broadcast temps réel."""
    from chat_manager import spotyou_manager
    pool = get_pool()
    user = await require_auth(request, pool)

    going_count_final = 0
    is_full_final = False
    next_date_final = None
    members_count_final = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
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

            going_count_final = await conn.fetchval(
                """SELECT COUNT(*) FROM spot_you_attendance
                   WHERE spot_you_id = $1 AND session_date = $2 AND status = 'going'""",
                point_id, next_date,
            ) if next_date else 0

            members_count_final = await conn.fetchval(
                "SELECT COUNT(*) FROM spot_you_members WHERE spot_you_id = $1", point_id
            )
            max_p = point["maximum_participants"]
            is_full_final = max_p is not None and (going_count_final or 0) >= max_p
            next_date_final = next_date

    # Broadcast temps réel après commit
    asyncio.create_task(spotyou_manager.broadcast(point_id, {
        "type": "spotyou_update",
        "point_id": point_id,
        "going_count": int(going_count_final or 0),
        "participants_count": int(members_count_final),
        "is_full": is_full_final,
        "session_date": next_date_final.isoformat() if next_date_final else None,
    }))

    return {
        "success": True,
        "is_going": False,
        "going_count": int(going_count_final or 0),
        "is_full": is_full_final,
        "session_date": next_date_final.isoformat() if next_date_final else None,
    }


@router.get("/spot-you/my-completion-stats")
async def my_completion_stats(request: Request):
    """
    Retourne les stats de complétion de profil liées aux SpotYou :
    - is_community_member : a rejoint au moins 1 communauté SpotYou (dont il n'est pas l'auteur)
    - has_participation   : a participé (going) à au moins 1 séance SpotYou
    """
    pool = get_pool()
    user = await require_auth(request, pool)
    uid = user["user_id"]

    async with pool.acquire() as conn:
        is_member = await conn.fetchval(
            """SELECT EXISTS(
                SELECT 1 FROM spot_you_members syp
                JOIN tag_points tp ON tp.point_id = syp.spot_you_id
                WHERE syp.user_id = $1 AND tp.user_id != $1
            )""",
            uid,
        )
        has_participation = await conn.fetchval(
            """SELECT EXISTS(
                SELECT 1 FROM spot_you_attendance
                WHERE user_id = $1 AND status = 'going'
            )""",
            uid,
        )

    return {
        "is_community_member": bool(is_member),
        "has_participation": bool(has_participation),
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
               FROM spot_you_members p
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
               FROM spot_you_members p
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
