from dataclasses import dataclass
import datetime


@dataclass
class GameSession:
    user_id: int
    game_name: str
    started_at: datetime.datetime
