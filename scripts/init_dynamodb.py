"""DynamoDB 테이블 생성 스크립트. 로컬은 `docker compose up -d` 이후, 운영은 AWS 자격증명 설정 후 한 번 실행.

사용법: python -m scripts.init_dynamodb
"""
import asyncio
from api.database import TABLE_PREFIX, _boto_session, _resource_kwargs

TABLES = [
    {
        "name": "user",
        "KeySchema": [{"AttributeName": "user_id", "KeyType": "HASH"}],
        "AttributeDefinitions": [{"AttributeName": "user_id", "AttributeType": "N"}],
    },
    {
        "name": "attendance",
        "KeySchema": [
            {"AttributeName": "user_id", "KeyType": "HASH"},
            {"AttributeName": "attendance_date", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id", "AttributeType": "N"},
            {"AttributeName": "attendance_date", "AttributeType": "S"},
        ],
    },
    {
        "name": "game_log",
        "KeySchema": [
            {"AttributeName": "user_id", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id", "AttributeType": "N"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
    },
    {
        "name": "gamble_log",
        "KeySchema": [
            {"AttributeName": "user_id", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id", "AttributeType": "N"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
    },
    {
        "name": "point_history",
        "KeySchema": [
            {"AttributeName": "user_id", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "user_id", "AttributeType": "N"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
    },
    {
        "name": "riot_favorite",
        "KeySchema": [
            {"AttributeName": "discord_user_id", "KeyType": "HASH"},
            {"AttributeName": "puuid", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "discord_user_id", "AttributeType": "N"},
            {"AttributeName": "puuid", "AttributeType": "S"},
        ],
    },
    {
        "name": "overwatch_favorite",
        "KeySchema": [
            {"AttributeName": "discord_user_id", "KeyType": "HASH"},
            {"AttributeName": "player_id", "KeyType": "RANGE"},
        ],
        "AttributeDefinitions": [
            {"AttributeName": "discord_user_id", "AttributeType": "N"},
            {"AttributeName": "player_id", "AttributeType": "S"},
        ],
    },
]


async def main():
    async with _boto_session.resource("dynamodb", **_resource_kwargs()) as resource:
        client = resource.meta.client
        existing = (await client.list_tables())["TableNames"]

        for t in TABLES:
            table_name = f"{TABLE_PREFIX}_{t['name']}"
            if table_name in existing:
                print(f"skip (already exists): {table_name}")
                continue
            await resource.create_table(
                TableName=table_name,
                KeySchema=t["KeySchema"],
                AttributeDefinitions=t["AttributeDefinitions"],
                BillingMode="PAY_PER_REQUEST",
            )
            print(f"created: {table_name}")


if __name__ == "__main__":
    asyncio.run(main())
