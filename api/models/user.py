from dataclasses import dataclass
import datetime


@dataclass
class User:
    user_id: int
    point: int = 0
    created_at: datetime.datetime | None = None
