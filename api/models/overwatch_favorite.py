from dataclasses import dataclass
import datetime


@dataclass
class OverwatchFavorite:
    discord_user_id: int
    player_id: str
    name: str
    title: str | None
    created_at: datetime.datetime | None = None
