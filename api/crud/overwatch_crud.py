import datetime
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.overwatch_favorite import OverwatchFavorite


def _row_to_favorite(item: dict) -> OverwatchFavorite:
    return OverwatchFavorite(
        discord_user_id=int(item["discord_user_id"]),
        player_id=item["player_id"],
        name=item["name"],
        title=item.get("title"),
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def get_favorites(session: DynamoSession, discord_user_id: int) -> list[OverwatchFavorite]:
    table = await session.table("overwatch_favorite")
    resp = await table.query(
        KeyConditionExpression=Key("discord_user_id").eq(discord_user_id),
    )
    items = sorted(resp.get("Items", []), key=lambda i: i["created_at"], reverse=True)
    return [_row_to_favorite(i) for i in items]


async def get_favorite(session: DynamoSession, discord_user_id: int, player_id: str) -> OverwatchFavorite | None:
    table = await session.table("overwatch_favorite")
    resp = await table.get_item(
        Key={"discord_user_id": discord_user_id, "player_id": player_id}
    )
    item = resp.get("Item")
    return _row_to_favorite(item) if item else None


async def add_favorite(
    session: DynamoSession,
    discord_user_id: int,
    player_id: str,
    name: str,
    title: str | None,
) -> OverwatchFavorite:
    now = datetime.datetime.utcnow()
    table = await session.table("overwatch_favorite")
    item = {
        "discord_user_id": discord_user_id,
        "player_id": player_id,
        "name": name,
        "created_at": now.isoformat(),
    }
    if title:
        item["title"] = title
    await table.put_item(Item=item)
    return OverwatchFavorite(
        discord_user_id=discord_user_id, player_id=player_id, name=name, title=title, created_at=now,
    )


async def remove_favorite(session: DynamoSession, discord_user_id: int, player_id: str) -> bool:
    table = await session.table("overwatch_favorite")
    resp = await table.delete_item(
        Key={"discord_user_id": discord_user_id, "player_id": player_id},
        ReturnValues="ALL_OLD",
    )
    return "Attributes" in resp
