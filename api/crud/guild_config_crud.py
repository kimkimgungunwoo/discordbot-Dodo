from api.database import DynamoSession


async def get_all_prefixes(session: DynamoSession) -> dict[int, str]:
    table = await session.table("guild_config")
    items = []
    resp = await table.scan()
    items.extend(resp.get("Items", []))
    while "LastEvaluatedKey" in resp:
        resp = await table.scan(ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp.get("Items", []))
    return {int(i["guild_id"]): i["prefix"] for i in items if i.get("prefix")}


async def set_prefix(session: DynamoSession, guild_id: int, prefix: str):
    table = await session.table("guild_config")
    await table.put_item(Item={"guild_id": guild_id, "prefix": prefix})
