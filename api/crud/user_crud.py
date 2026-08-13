import datetime
import uuid
from api.database import DynamoSession
from api.models.user import User
from api.models.enums import PointReason


def _row_to_user(item: dict) -> User:
    return User(
        user_id=int(item["user_id"]),
        point=int(item["point"]),
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def get_user(session: DynamoSession, user_id: int) -> User | None:
    if user_id in session.user_cache:
        return session.user_cache[user_id]

    table = await session.table("user")
    resp = await table.get_item(Key={"user_id": user_id})
    item = resp.get("Item")
    if item is None:
        return None

    user = _row_to_user(item)
    session.user_cache[user_id] = user
    return user


async def _apply_point(session: DynamoSession, user: User, amount: int, reason: PointReason) -> None:
    """user.point 갱신 + PointHistory 기록. DynamoDB에는 즉시 반영된다(별도 commit 없음)."""
    user.point += amount
    user_table = await session.table("user")
    await user_table.update_item(
        Key={"user_id": user.user_id},
        UpdateExpression="SET #p = :p",
        ExpressionAttributeNames={"#p": "point"},
        ExpressionAttributeValues={":p": user.point},
    )

    now = datetime.datetime.utcnow()
    history_table = await session.table("point_history")
    await history_table.put_item(Item={
        "user_id": user.user_id,
        "sk": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}",
        "amount": amount,
        "reason": reason.value,
        "created_at": now.isoformat(),
    })


async def register_user(session: DynamoSession, user_id: int) -> User:
    now = datetime.datetime.utcnow()
    user = User(user_id=user_id, point=0, created_at=now)
    table = await session.table("user")
    await table.put_item(Item={
        "user_id": user_id,
        "point": 0,
        "created_at": now.isoformat(),
    })
    session.user_cache[user_id] = user

    await _apply_point(session, user, 1000, PointReason.admin)
    return user
