from dataclasses import dataclass


@dataclass
class GameStat:
    user_id: int
    game_name: str
    total_seconds: int
