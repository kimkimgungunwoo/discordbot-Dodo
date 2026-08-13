from dataclasses import dataclass
import datetime
from api.models.enums import PointReason


@dataclass
class PointHistory:
    user_id: int
    amount: int
    reason: PointReason
    created_at: datetime.datetime | None = None
