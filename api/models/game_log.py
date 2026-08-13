from dataclasses import dataclass
import datetime
from api.models.enums import GameType


@dataclass
class GameLog:
    user_id: int
    game_type: GameType
    result: str
    point: int
    created_at: datetime.datetime | None = None
