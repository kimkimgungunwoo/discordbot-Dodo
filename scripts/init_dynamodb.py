"""DynamoDB 테이블 생성 스크립트. 로컬은 `docker compose up -d` 이후, 운영은 AWS 자격증명 설정 후 한 번 실행.

사용법: python -m scripts.init_dynamodb
"""
import asyncio
from api.database import TABLE_PREFIX, _boto_session, _resource_kwargs

_GUILD_SK = {
    "KeySchema": [
        {"AttributeName": "guild_id", "KeyType": "HASH"},
        {"AttributeName": "sk", "KeyType": "RANGE"},
    ],
    "AttributeDefinitions": [
        {"AttributeName": "guild_id", "AttributeType": "N"},
        {"AttributeName": "sk", "AttributeType": "S"},
    ],
}

# economy(user/attendance/게임·도박 기록/point_history)는 전부 길드 스코프 없이 전역 —
# 여러 서버에 걸쳐 같은 지갑/전적을 쓰는 걸로 결정됨. guild_id가 붙는 건 analytics(채팅/통화/게임 통계)뿐.
_USER_SK = {
    "KeySchema": [
        {"AttributeName": "user_id", "KeyType": "HASH"},
        {"AttributeName": "sk", "KeyType": "RANGE"},
    ],
    "AttributeDefinitions": [
        {"AttributeName": "user_id", "AttributeType": "N"},
        {"AttributeName": "sk", "AttributeType": "S"},
    ],
}

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
    {"name": "game_log", **_USER_SK},
    {"name": "gamble_log", **_USER_SK},
    {"name": "point_history", **_USER_SK},
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
    {"name": "chat_stat", **_GUILD_SK},
    {"name": "voice_session", **_GUILD_SK},
    {"name": "voice_stat", **_GUILD_SK},
    {
        "name": "backfill_progress",
        "KeySchema": [{"AttributeName": "channel_id", "KeyType": "HASH"}],
        "AttributeDefinitions": [{"AttributeName": "channel_id", "AttributeType": "N"}],
    },
    {"name": "chat_hourly", **_GUILD_SK},
    {"name": "voice_hourly", **_GUILD_SK},
    {"name": "voice_pair", **_GUILD_SK},
    {"name": "game_stat", **_GUILD_SK},
    {
        "name": "guild_config",
        "KeySchema": [{"AttributeName": "guild_id", "KeyType": "HASH"}],
        "AttributeDefinitions": [{"AttributeName": "guild_id", "AttributeType": "N"}],
    },
    {"name": "game_session", **_GUILD_SK},
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
