from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from api.models.riot_favorite import RiotFavorite


async def get_favorites(session: AsyncSession, discord_user_id: int) -> list[RiotFavorite]:
    result = await session.execute(
        select(RiotFavorite)
        .where(RiotFavorite.discord_user_id == discord_user_id)
        .order_by(RiotFavorite.created_at.desc())
    )
    return list(result.scalars().all())


async def get_favorite(
    session: AsyncSession, discord_user_id: int, puuid: str
) -> RiotFavorite | None:
    result = await session.execute(
        select(RiotFavorite).where(
            RiotFavorite.discord_user_id == discord_user_id,
            RiotFavorite.puuid == puuid,
        )
    )
    return result.scalar_one_or_none()


async def add_favorite(
    session: AsyncSession,
    discord_user_id: int,
    puuid: str,
    game_name: str,
    tag_line: str,
) -> RiotFavorite:
    fav = RiotFavorite(
        discord_user_id=discord_user_id,
        puuid=puuid,
        game_name=game_name,
        tag_line=tag_line,
    )
    session.add(fav)
    await session.commit()
    return fav


async def remove_favorite(
    session: AsyncSession, discord_user_id: int, puuid: str
) -> bool:
    fav = await get_favorite(session, discord_user_id, puuid)
    if fav is None:
        return False
    await session.delete(fav)
    await session.commit()
    return True
