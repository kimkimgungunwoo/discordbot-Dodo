from dataclasses import dataclass
import datetime


@dataclass
class MusicFavorite:
    discord_user_id: int
    video_id: str
    title: str
    author: str
    length_ms: int
    uri: str
    created_at: datetime.datetime | None = None
