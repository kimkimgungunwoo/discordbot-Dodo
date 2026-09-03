from dataclasses import dataclass
import datetime


@dataclass
class VoiceStat:
    user_id: int
    total_seconds: int
    session_count: int
    last_left_at: datetime.datetime | None = None
