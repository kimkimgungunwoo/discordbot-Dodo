import datetime
import uuid
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.chat_stat import ChatStat
from api.models.voice_session import VoiceSession
from api.models.voice_stat import VoiceStat
from api.models.backfill_progress import BackfillProgress
from api.models.chat_hourly import ChatHourly
from api.models.voice_hourly import VoiceHourly
from api.models.voice_pair import VoicePair
from api.models.game_stat import GameStat


_MAX_SESSION_SECONDS = 24 * 3600


def kst_hour(when: datetime.datetime) -> int:
    return (when.hour + 9) % 24


def _voice_hourly_chunks(joined_at: datetime.datetime, left_at: datetime.datetime) -> list[tuple[int, int]]:
    chunks: list[tuple[int, int]] = []
    cur = joined_at
    while cur < left_at:
        hour_end = cur.replace(minute=0, second=0, microsecond=0) + datetime.timedelta(hours=1)
        chunk_end = min(hour_end, left_at)
        seconds = int((chunk_end - cur).total_seconds())
        if seconds > 0:
            chunks.append((kst_hour(cur), seconds))
        cur = chunk_end
    return chunks


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


async def scan_chat_stats(session: DynamoSession) -> list[ChatStat]:
    table = await session.table("chat_stat")
    return [_row_to_chat_stat(i) for i in await _scan_all(table)]


async def delete_all_chat_stats(session: DynamoSession):
    table = await session.table("chat_stat")
    for item in await _scan_all(table):
        await table.delete_item(Key={"user_id": item["user_id"]})


async def increment_chat_hourly_by_hour(session: DynamoSession, user_id: int, hour: int, count: int = 1):
    table = await session.table("chat_hourly")
    await table.update_item(
        Key={"user_id": user_id, "hour": hour},
        UpdateExpression="ADD message_count :n",
        ExpressionAttributeValues={":n": count},
    )


async def increment_chat_hourly(session: DynamoSession, user_id: int, when: datetime.datetime, count: int = 1):
    await increment_chat_hourly_by_hour(session, user_id, kst_hour(when), count=count)


async def scan_chat_hourly(session: DynamoSession) -> list[ChatHourly]:
    table = await session.table("chat_hourly")
    return [
        ChatHourly(hour=int(i["hour"]), message_count=int(i.get("message_count", 0)))
        for i in await _scan_all(table)
    ]


async def get_chat_hourly_for_user(session: DynamoSession, user_id: int) -> list[ChatHourly]:
    table = await session.table("chat_hourly")
    resp = await table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return [
        ChatHourly(hour=int(i["hour"]), message_count=int(i.get("message_count", 0)))
        for i in resp.get("Items", [])
    ]


async def delete_all_chat_hourly(session: DynamoSession):
    table = await session.table("chat_hourly")
    for item in await _scan_all(table):
        await table.delete_item(Key={"user_id": item["user_id"], "hour": item["hour"]})


async def start_voice_session(
    session: DynamoSession, user_id: int, joined_at: datetime.datetime, channel_id: int | None = None,
) -> str:
    sk = f"{joined_at.isoformat()}#{uuid.uuid4().hex[:8]}"
    table = await session.table("voice_session")
    item = {"user_id": user_id, "sk": sk, "joined_at": joined_at.isoformat()}
    if channel_id is not None:
        item["channel_id"] = channel_id
    await table.put_item(Item=item)
    return sk


async def find_open_voice_session(session: DynamoSession, user_id: int) -> VoiceSession | None:
    table = await session.table("voice_session")
    resp = await table.query(
        KeyConditionExpression=Key("user_id").eq(user_id),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    return _row_to_voice_session(items[0]) if items else None


async def scan_open_voice_sessions(session: DynamoSession) -> list[VoiceSession]:
    table = await session.table("voice_session")
    return [_row_to_voice_session(i) for i in await _scan_all(table)]


async def drop_voice_session(session: DynamoSession, user_id: int, sk: str):
    table = await session.table("voice_session")
    await table.delete_item(Key={"user_id": user_id, "sk": sk})


async def close_voice_session(
    session: DynamoSession, user_id: int, sk: str, left_at: datetime.datetime, bump_count: bool = True,
) -> int:
    table = await session.table("voice_session")
    resp = await table.get_item(Key={"user_id": user_id, "sk": sk})
    item = resp.get("Item")
    if item is None:
        return 0
    joined_at = datetime.datetime.fromisoformat(item["joined_at"])
    duration = min(max(int((left_at - joined_at).total_seconds()), 0), _MAX_SESSION_SECONDS)
    await table.delete_item(Key={"user_id": user_id, "sk": sk})
    await _increment_voice_stat(session, user_id, duration, left_at, bump_count)
    for hour, seconds in _voice_hourly_chunks(joined_at, joined_at + datetime.timedelta(seconds=duration)):
        await _add_voice_hourly(session, user_id, hour, seconds)
    return duration


async def checkpoint_voice_session(session: DynamoSession, user_id: int, sk: str, now: datetime.datetime) -> int:
    table = await session.table("voice_session")
    resp = await table.get_item(Key={"user_id": user_id, "sk": sk})
    item = resp.get("Item")
    if item is None:
        return 0
    joined_at = datetime.datetime.fromisoformat(item["joined_at"])
    duration = min(max(int((now - joined_at).total_seconds()), 0), _MAX_SESSION_SECONDS)
    if duration <= 0:
        return 0
    await table.update_item(
        Key={"user_id": user_id, "sk": sk},
        UpdateExpression="SET joined_at = :t",
        ExpressionAttributeValues={":t": now.isoformat()},
    )
    await _increment_voice_stat(session, user_id, duration, now, bump_count=False)
    for hour, seconds in _voice_hourly_chunks(joined_at, joined_at + datetime.timedelta(seconds=duration)):
        await _add_voice_hourly(session, user_id, hour, seconds)
    return duration


async def _increment_voice_stat(
    session: DynamoSession, user_id: int, seconds: int, when: datetime.datetime, bump_count: bool = True,
):
    expr = "ADD total_seconds :s" + (", session_count :n" if bump_count else "") + " SET last_left_at = :t"
    vals = {":s": seconds, ":t": when.isoformat()}
    if bump_count:
        vals[":n"] = 1
    table = await session.table("voice_stat")
    await table.update_item(Key={"user_id": user_id}, UpdateExpression=expr, ExpressionAttributeValues=vals)


async def _add_voice_hourly(session: DynamoSession, user_id: int, hour: int, seconds: int):
    table = await session.table("voice_hourly")
    await table.update_item(
        Key={"user_id": user_id, "hour": hour},
        UpdateExpression="ADD total_seconds :s",
        ExpressionAttributeValues={":s": seconds},
    )


async def scan_voice_hourly(session: DynamoSession) -> list[VoiceHourly]:
    table = await session.table("voice_hourly")
    return [
        VoiceHourly(hour=int(i["hour"]), total_seconds=int(i.get("total_seconds", 0)))
        for i in await _scan_all(table)
    ]


async def get_voice_hourly_for_user(session: DynamoSession, user_id: int) -> list[VoiceHourly]:
    table = await session.table("voice_hourly")
    resp = await table.query(KeyConditionExpression=Key("user_id").eq(user_id))
    return [
        VoiceHourly(hour=int(i["hour"]), total_seconds=int(i.get("total_seconds", 0)))
        for i in resp.get("Items", [])
    ]


async def scan_voice_stats(session: DynamoSession) -> list[VoiceStat]:
    table = await session.table("voice_stat")
    return [_row_to_voice_stat(i) for i in await _scan_all(table)]


def _pair_key(a: int, b: int) -> str:
    lo, hi = sorted((a, b))
    return f"{lo}#{hi}"


async def add_voice_pair(session: DynamoSession, a: int, b: int, seconds: int):
    table = await session.table("voice_pair")
    await table.update_item(
        Key={"pair": _pair_key(a, b)},
        UpdateExpression="ADD total_seconds :s",
        ExpressionAttributeValues={":s": seconds},
    )


async def scan_voice_pairs(session: DynamoSession) -> list[VoicePair]:
    table = await session.table("voice_pair")
    out = []
    for i in await _scan_all(table):
        lo, hi = i["pair"].split("#")
        out.append(VoicePair(a=int(lo), b=int(hi), total_seconds=int(i.get("total_seconds", 0))))
    return out


async def add_game_stat(session: DynamoSession, user_id: int, game_name: str, seconds: int):
    table = await session.table("game_stat")
    await table.update_item(
        Key={"user_id": user_id, "game_name": game_name},
        UpdateExpression="ADD total_seconds :s",
        ExpressionAttributeValues={":s": seconds},
    )


async def scan_game_stats(session: DynamoSession) -> list[GameStat]:
    table = await session.table("game_stat")
    return [
        GameStat(user_id=int(i["user_id"]), game_name=i["game_name"], total_seconds=int(i.get("total_seconds", 0)))
        for i in await _scan_all(table)
    ]


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


if __name__ == "__main__":
    j = datetime.datetime(2026, 9, 7, 12, 50)
    l = datetime.datetime(2026, 9, 7, 15, 10)
    chunks = _voice_hourly_chunks(j, l)
    assert chunks == [(21, 600), (22, 3600), (23, 3600), (0, 600)], chunks
    assert sum(s for _, s in chunks) == int((l - j).total_seconds())
    assert _voice_hourly_chunks(
        datetime.datetime(2026, 9, 7, 12, 10), datetime.datetime(2026, 9, 7, 12, 40)
    ) == [(21, 1800)]
    assert _voice_hourly_chunks(j, j) == []
    print("ok")
