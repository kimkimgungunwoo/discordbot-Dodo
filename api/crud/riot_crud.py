import datetime
from boto3.dynamodb.conditions import Key
from api.database import DynamoSession
from api.models.riot_favorite import RiotFavorite


def _row_to_favorite(item: dict) -> RiotFavorite:
    return RiotFavorite(
        discord_user_id=int(item["discord_user_id"]),
        puuid=item["puuid"],
        game_name=item["game_name"],
        tag_line=item["tag_line"],
        created_at=datetime.datetime.fromisoformat(item["created_at"]),
    )


async def get_favorites(session: DynamoSession, discord_user_id: int) -> list[RiotFavorite]:
    table = await session.table("riot_favorite")
    resp = await table.query(
        KeyConditionExpression=Key("discord_user_id").eq(discord_user_id),
    )
    items = sorted(resp.get("Items", []), key=lambda i: i["created_at"], reverse=True)
    return [_row_to_favorite(i) for i in items]


async def get_favorite(session: DynamoSession, discord_user_id: int, puuid: str) -> RiotFavorite | None:
    table = await session.table("riot_favorite")
    resp = await table.get_item(
        Key={"discord_user_id": discord_user_id, "puuid": puuid}
    )
    item = resp.get("Item")
    return _row_to_favorite(item) if item else None


async def add_favorite(
    session: DynamoSession,
    discord_user_id: int,
    puuid: str,
    game_name: str,
    tag_line: str,
) -> RiotFavorite:
    now = datetime.datetime.utcnow()
    table = await session.table("riot_favorite")
    await table.put_item(Item={
        "discord_user_id": discord_user_id,
        "puuid": puuid,
        "game_name": game_name,
        "tag_line": tag_line,
        "created_at": now.isoformat(),
    })
    return RiotFavorite(
        discord_user_id=discord_user_id, puuid=puuid, game_name=game_name, tag_line=tag_line, created_at=now,
    )


async def remove_favorite(session: DynamoSession, discord_user_id: int, puuid: str) -> bool:
    table = await session.table("riot_favorite")
    resp = await table.delete_item(
        Key={"discord_user_id": discord_user_id, "puuid": puuid},
        ReturnValues="ALL_OLD",
    )
    return "Attributes" in resp
