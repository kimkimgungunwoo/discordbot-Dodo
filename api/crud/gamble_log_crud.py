from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.models.gamble_log import GambleLog
from api.models.user import User
from api.models.enums import GambleType, PointReason
from api.crud.user_crud import _apply_point


async def create_gamble_log(
    session: AsyncSession,
    user: User,
    gamble_type: GambleType,
    point: int,
) -> GambleLog:
    log = GambleLog(user_id=user.user_id, gamble_type=gamble_type, point=point)
    session.add(log)
    reason = PointReason.gamble_win if point > 0 else PointReason.gamble_lose
    _apply_point(session, user, point, reason)
    await session.commit()
    return log


async def get_recent_gamble_logs(
    session: AsyncSession, user_id: int, limit: int = 5
) -> list[GambleLog]:
    result = await session.execute(
        select(GambleLog)
        .where(GambleLog.user_id == user_id)
        .order_by(GambleLog.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
