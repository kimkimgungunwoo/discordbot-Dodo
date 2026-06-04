import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.models.attendance import Attendance
from api.models.enums import PointReason
from api.crud.user_crud import get_user, _apply_point


async def get_today_attendance(session: AsyncSession, user_id: int) -> Attendance | None:
    today = datetime.date.today()
    result = await session.execute(
        select(Attendance).where(
            Attendance.user_id == user_id,
            Attendance.attendance_date == today,
        )
    )
    return result.scalar_one_or_none()


async def create_attendance(session: AsyncSession, user_id: int, point: int) -> Attendance:
    attendance = Attendance(
        user_id=user_id,
        attendance_date=datetime.date.today(),
        point=point,
    )
    session.add(attendance)
    user = await get_user(session, user_id)
    _apply_point(session, user, point, PointReason.attendance)
    await session.commit()
    await session.refresh(user)
    return attendance
