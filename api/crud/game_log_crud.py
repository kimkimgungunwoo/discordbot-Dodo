import datetime
import uuid
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.game_log import GameLog
from api.models.user import User
from api.models.enums import GameType, PointReason
from api.crud.user_crud import _apply_point


def _row_to_log(item: dict) -> GameLog:
    return GameLog(
        user_id=int(item["user_id"]),
        game_type=GameType(item["game_type"]),
        result=item["result"],
        point=int(item["point"]),
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def create_game_log(
    session: DynamoSession,
    user: User,
    game_type: GameType,
    result: str,
    point: int,
) -> GameLog:
    now = datetime.datetime.utcnow()
    table = await session.table("game_log")
    await table.put_item(Item={
        "user_id": user.user_id,
        "sk": f"{now.isoformat()}#{uuid.uuid4().hex[:8]}",
        "game_type": game_type.value,
        "result": result,
        "point": point,
        "created_at": now.isoformat(),
    })

    if point > 0:
        await _apply_point(session, user, point, PointReason.game_win)
    elif point < 0:
        await _apply_point(session, user, point, PointReason.game_lose)

    return GameLog(user_id=user.user_id, game_type=game_type, result=result, point=point, created_at=now)


async def get_recent_game_logs(session: DynamoSession, user_id: int, limit: int = 10) -> list[GameLog]:
    table = await session.table("game_log")
    resp = await table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=limit,
    )
    return [_row_to_log(i) for i in resp.get("Items", [])]
