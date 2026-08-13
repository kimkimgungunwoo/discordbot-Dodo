from dataclasses import dataclass
import datetime


@dataclass
class RiotFavorite:
    discord_user_id: int
    puuid: str
    game_name: str
    tag_line: str
    created_at: datetime.datetime | None = None
