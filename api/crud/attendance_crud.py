import datetime
from api.database import DynamoSession
from api.models.attendance import Attendance
from api.models.enums import PointReason
from api.crud.user_crud import get_user, _apply_point


async def get_today_attendance(session: DynamoSession, user_id: int) -> Attendance | None:
    today = datetime.date.today()
    table = await session.table("attendance")
    resp = await table.get_item(
        Key={"user_id": user_id, "attendance_date": today.isoformat()}
    )
    item = resp.get("Item")
    if item is None:
        return None

    return Attendance(
        user_id=int(item["user_id"]),
        attendance_date=datetime.date.fromisoformat(item["attendance_date"]),
        point=int(item["point"]),
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def create_attendance(session: DynamoSession, user_id: int, point: int) -> Attendance:
    today = datetime.date.today()
    now = datetime.datetime.utcnow()

    table = await session.table("attendance")
    await table.put_item(Item={
        "user_id": user_id,
        "attendance_date": today.isoformat(),
        "point": point,
        "created_at": now.isoformat(),
    })

    user = await get_user(session, user_id)
    await _apply_point(session, user, point, PointReason.attendance)

    return Attendance(user_id=user_id, attendance_date=today, point=point, created_at=now)
