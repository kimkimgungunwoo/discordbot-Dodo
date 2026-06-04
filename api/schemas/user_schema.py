import datetime
from pydantic import BaseModel, ConfigDict


class UserBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserInfo(UserBase):
    user_nickname: str
    point: int
    created_at: datetime.datetime
