import datetime
import uuid
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.chat_stat import ChatStat
from api.models.voice_session import VoiceSession
from api.models.voice_stat import VoiceStat
from api.models.backfill_progress import BackfillProgress


def _row_to_chat_stat(item: dict) -> ChatStat:
    return ChatStat(
        user_id=int(item["user_id"]),
        message_count=int(item.get("message_count", 0)),
        last_message_at=datetime.datetime.fromisoformat(item["last_message_at"]) if item.get("last_message_at") else None,
    )


def _row_to_voice_session(item: dict) -> VoiceSession:
    return VoiceSession(
        user_id=int(item["user_id"]),
        sk=item["sk"],
        joined_at=datetime.datetime.fromisoformat(item["joined_at"]),
        left_at=datetime.datetime.fromisoformat(item["left_at"]) if item.get("left_at") else None,
    )


def _row_to_voice_stat(item: dict) -> VoiceStat:
    return VoiceStat(
        user_id=int(item["user_id"]),
        total_seconds=int(item.get("total_seconds", 0)),
        session_count=int(item.get("session_count", 0)),
        last_left_at=datetime.datetime.fromisoformat(item["last_left_at"]) if item.get("last_left_at") else None,
    )


async def _scan_all(table) -> list[dict]:
    items = []
    resp = await table.scan()
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp:
        resp = await table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    return items


async def increment_chat_stat(session: DynamoSession, user_id: int, when: datetime.datetime, count: int = 1):
    table = await session.table("chat_stat")
    await table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="ADD message_count :n SET last_message_at = :t",
        ExpressionAttributeValues={":n": count, ":t": when.isoformat()},
    )


async def get_chat_stat(session: DynamoSession, user_id: int) -> ChatStat | None:
    table = await session.table("chat_stat")
    resp = await table.get_item(Key={"user_id": user_id})
    item = resp.get("Item")
    return _row_to_chat_stat(item) if item else None


async def scan_chat_stats(session: DynamoSession) -> list[ChatStat]:
    table = await session.table("chat_stat")
    return [_row_to_chat_stat(i) for i in await _scan_all(table)]


async def delete_all_chat_stats(session: DynamoSession):
    table = await session.table("chat_stat")
    for item in await _scan_all(table):
        await table.delete_item(Key={"user_id": item["user_id"]})


async def start_voice_session(session: DynamoSession, user_id: int, joined_at: datetime.datetime) -> str:
    sk = f"{joined_at.isoformat()}#{uuid.uuid4().hex[:8]}"
    table = await session.table("voice_session")
    await table.put_item(Item={"user_id": user_id, "sk": sk, "joined_at": joined_at.isoformat()})
    return sk


async def find_open_voice_session(session: DynamoSession, user_id: int) -> VoiceSession | None:
    table = await session.table("voice_session")
    resp = await table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    if not items or items[0].get("left_at"):
        return None
    return _row_to_voice_session(items[0])


async def close_voice_session(session: DynamoSession, user_id: int, sk: str, left_at: datetime.datetime) -> int:
    table = await session.table("voice_session")
    resp = await table.get_item(Key={"user_id": user_id, "sk": sk})
    item = resp.get("Item")
    if item is None or item.get("left_at"):
        return 0
    joined_at = datetime.datetime.fromisoformat(item["joined_at"])
    duration = max(int((left_at - joined_at).total_seconds()), 0)
    await table.update_item(
        Key={"user_id": user_id, "sk": sk},
        UpdateExpression="SET left_at = :t",
        ExpressionAttributeValues={":t": left_at.isoformat()},
    )
    await _increment_voice_stat(session, user_id, duration, left_at)
    return duration


async def _increment_voice_stat(session: DynamoSession, user_id: int, seconds: int, when: datetime.datetime):
    table = await session.table("voice_stat")
    await table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="ADD total_seconds :s, session_count :n SET last_left_at = :t",
        ExpressionAttributeValues={":s": seconds, ":n": 1, ":t": when.isoformat()},
    )


async def get_voice_stat(session: DynamoSession, user_id: int) -> VoiceStat | None:
    table = await session.table("voice_stat")
    resp = await table.get_item(Key={"user_id": user_id})
    item = resp.get("Item")
    return _row_to_voice_stat(item) if item else None


async def scan_voice_stats(session: DynamoSession) -> list[VoiceStat]:
    table = await session.table("voice_stat")
    return [_row_to_voice_stat(i) for i in await _scan_all(table)]


async def get_backfill_progress(session: DynamoSession, channel_id: int) -> BackfillProgress | None:
    table = await session.table("backfill_progress")
    resp = await table.get_item(Key={"channel_id": channel_id})
    item = resp.get("Item")
    if item is None:
        return None
    return BackfillProgress(
        channel_id=int(item["channel_id"]),
        cursor_id=int(item["cursor_id"]) if item.get("cursor_id") is not None else None,
        done=bool(item.get("done", False)),
    )


async def set_backfill_progress(session: DynamoSession, channel_id: int, cursor_id: int | None, done: bool):
    table = await session.table("backfill_progress")
    await table.put_item(Item={"channel_id": channel_id, "cursor_id": cursor_id, "done": done})


async def delete_all_backfill_progress(session: DynamoSession):
    table = await session.table("backfill_progress")
    for item in await _scan_all(table):
        await table.delete_item(Key={"channel_id": item["channel_id"]})
