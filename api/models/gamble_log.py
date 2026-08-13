from dataclasses import dataclass
import datetime
from api.models.enums import GambleType


@dataclass
class GambleLog:
    user_id: int
    gamble_type: GambleType
    point: int
    created_at: datetime.datetime | None = None
