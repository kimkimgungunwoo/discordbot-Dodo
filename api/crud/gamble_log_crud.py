import datetime
import uuid
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.gamble_log import GambleLog
from api.models.user import User
from api.models.enums import GambleType, PointReason
from api.crud.user_crud import _apply_point


def _row_to_log(item: dict) -> GambleLog:
    return GambleLog(
        user_id=int(item["user_id"]),
        gamble_type=GambleType(item["gamble_type"]),
        point=int(item["point"]),
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def create_gamble_log(
    session: DynamoSession,
    user: User,
    gamble_type: GambleType,
    point: int,
) -> GambleLog:
    now = datetime.datetime.utcnow()
    table = await session.table("gamble_log")
    await table.put_item(Item={
        "user_id": user.user_id,
        "sk": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}",
        "gamble_type": gamble_type.value,
        "point": point,
        "created_at": now.isoformat(),
    })

    reason = PointReason.gamble_win if point > 0 else PointReason.gamble_lose
    await _apply_point(session, user, point, reason)

    return GambleLog(user_id=user.user_id, gamble_type=gamble_type, point=point, created_at=now)


async def get_recent_gamble_logs(session: DynamoSession, user_id: int, limit: int = 5) -> list[GambleLog]:
    table = await session.table("gamble_log")
    resp = await table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return [_row_to_log(i) for i in resp.get("Items", [])]


async def _all_gamble_items(session: DynamoSession, user_id: int) -> list[dict]:
    # ponytail: 유저당 전체 스캔 — 도박 기록이 수만 건 단위로 커지면
    # user 테이블에 누적 net/win_count 카운터를 별도로 유지하는 방식으로 교체
    table = await session.table("gamble_log")
    items = []
    resp = await table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp:
        resp = await table.query(
            KeyConditionExpression=Key("user_id").eq(user_id),
            ExclusiveStartKey=resp["LastEvaluatedKey"],
        )
        items.extend(resp.get("Items", []))
    return items


async def get_total_gamble_net(session: DynamoSession, user_id: int) -> int:
    items = await _all_gamble_items(session, user_id)
    return sum(int(i["point"]) for i in items)


async def get_total_gamble_win_rate(session: DynamoSession, user_id: int) -> float:
    items = await _all_gamble_items(session, user_id)
    total = len(items)
    if total == 0:
        return 0.0
    wins = sum(1 for i in items if int(i["point"]) > 0)
    return round(wins / total * 100, 1)
