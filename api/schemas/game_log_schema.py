from pydantic import BaseModel, ConfigDict
from api.models.enums import GameType
from api.schemas.user_schema import UserInfo


class GameLogBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class GameLogInfo(GameLogBase):
    game_type: GameType
    result: str
    point: int


class GameLogListInfo(GameLogBase):
    user: UserInfo
    game_log_list: list[GameLogInfo]
    win_rate: float
