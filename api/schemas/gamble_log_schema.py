from pydantic import BaseModel, ConfigDict
from api.models.enums import GambleType
from api.schemas.user_schema import UserInfo


class GambleLogBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class GambleLogInfo(GambleLogBase):
    gamble_type: GambleType
    result: str
    point: int


class GambleLogListInfo(GambleLogBase):
    user: UserInfo
    gamble_log_list: list[GambleLogInfo]
    win_rate: float
    total_win_rate: float
    total_net: int
