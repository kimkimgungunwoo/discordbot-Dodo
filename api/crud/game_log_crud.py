from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.models.game_log import GameLog
from api.models.user import User
from api.models.enums import GameType, PointReason
from api.crud.user_crud import _apply_point


async def create_game_log(
    session: AsyncSession,
    user: User,
    game_type: GameType,
    result: str,
    point: int,
) -> GameLog:
    log = GameLog(user_id=user.user_id, game_type=game_type, result=result, point=point)
    session.add(log)
    if point > 0:
        _apply_point(session, user, point, PointReason.game_win)
    elif point < 0:
        _apply_point(session, user, point, PointReason.game_lose)
    await session.commit()
    return log


async def get_recent_game_logs(
    session: AsyncSession, user_id: int, limit: int = 10
) -> list[GameLog]:
    result = await session.execute(
        select(GameLog)
        .where(GameLog.user_id == user_id)
        .order_by(GameLog.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
