from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.models.user import User
from api.models.point_history import PointHistory
from api.models.enums import PointReason


async def get_user(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(select(User).where(User.user_id == user_id))
    return result.scalar_one_or_none()


def _apply_point(session: AsyncSession, user: User, amount: int, reason: PointReason) -> None:
    """user.point 변경 + PointHistory 추가. 커밋은 호출자가 담당."""
    user.point += amount
    session.add(PointHistory(user_id=user.user_id, amount=amount, reason=reason))


async def register_user(session: AsyncSession, user_id: int) -> User:
    user = User(user_id=user_id, point=0)
    session.add(user)
    await session.flush()  # user_id FK 확보
    _apply_point(session, user, 1000, PointReason.admin)
    await session.commit()
    await session.refresh(user)
    return user
