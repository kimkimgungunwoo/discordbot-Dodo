import datetime
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.music_favorite import MusicFavorite

MAX_FAVORITES = 100


def _row_to_favorite(item: dict) -> MusicFavorite:
    return MusicFavorite(
        discord_user_id=int(item["discord_user_id"]),
        video_id=item["video_id"],
        title=item["title"],
        author=item["author"],
        length_ms=int(item["length_ms"]),
        uri=item["uri"],
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def get_favorites(session: DynamoSession, discord_user_id: int) -> list[MusicFavorite]:
    table = await session.table("music_favorite")
    resp = await table.query(KeyConditionExpression=Key("discord_user_id").eq(discord_user_id))
    items = sorted(resp.get("Items", []), key=lambda i: i["created_at"], reverse=True)
    return [_row_to_favorite(i) for i in items]


async def get_favorite(session: DynamoSession, discord_user_id: int, video_id: str) -> MusicFavorite | None:
    table = await session.table("music_favorite")
    resp = await table.get_item(Key={"discord_user_id": discord_user_id, "video_id": video_id})
    item = resp.get("Item")
    return _row_to_favorite(item) if item else None


async def add_favorite(
    session: DynamoSession, discord_user_id: int, video_id: str, title: str, author: str, length_ms: int, uri: str,
) -> MusicFavorite:
    now = datetime.datetime.utcnow()
    table = await session.table("music_favorite")
    await table.put_item(Item={
        "discord_user_id": discord_user_id,
        "video_id": video_id,
        "title": title,
        "author": author,
        "length_ms": length_ms,
        "uri": uri,
        "created_at": now.isoformat(),
    })
    return MusicFavorite(discord_user_id, video_id, title, author, length_ms, uri, now)


async def remove_favorite(session: DynamoSession, discord_user_id: int, video_id: str) -> bool:
    table = await session.table("music_favorite")
    resp = await table.delete_item(
        Key={"discord_user_id": discord_user_id, "video_id": video_id}, ReturnValues="ALL_OLD",
    )
    return "Attributes" in resp
