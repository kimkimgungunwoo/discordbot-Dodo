import os
import aioboto3
from dotenv import load_dotenv

load_dotenv()

TABLE_PREFIX = os.getenv("DYNAMODB_TABLE_PREFIX", "discordbot")

_boto_session = aioboto3.Session()


def _resource_kwargs() -> dict:
    kwargs = {"region_name": os.getenv("AWS_REGION", "ap-northeast-2")}
    endpoint = os.getenv("DYNAMODB_ENDPOINT_URL")
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return kwargs


class DynamoSession:
    """SQLAlchemy AsyncSession과 같은 모양(`session.table(...)`)으로 쓰기 위한 얇은 래퍼.

    user_id별 User 캐시를 들고 있어서, 같은 세션 안에서 get_user()를 여러 번 불러도
    항상 같은 객체를 돌려준다 — _apply_point()가 그 객체를 직접 mutate하기 때문에
    (기존 SQLAlchemy identity map이 하던 역할과 동일), 이게 없으면
    `!출석`처럼 "먼저 get_user로 받아둔 user와, crud 내부에서 다시 get_user한 user"가
    서로 다른 객체가 되어 포인트 반영이 안 보이는 버그가 생긴다.
    """

    def __init__(self, resource):
        self.resource = resource
        self.user_cache: dict[int, object] = {}

    async def table(self, name: str):
        # aioboto3의 리소스 서브팩토리(.Table())는 코루틴이라 await가 필요하다 (boto3 동기 API와 다른 점)
        return await self.resource.Table(f"{TABLE_PREFIX}_{name}")


class SessionLocal:
    """`async with SessionLocal() as session:` 형태로 쓰는 세션 컨텍스트매니저."""

    async def __aenter__(self) -> DynamoSession:
        self._cm = _boto_session.resource("dynamodb", **_resource_kwargs())
        resource = await self._cm.__aenter__()
        self.session = DynamoSession(resource)
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        await self._cm.__aexit__(exc_type, exc, tb)


async def get_db():
    async with SessionLocal() as session:
        yield session
