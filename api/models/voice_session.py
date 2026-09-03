from dataclasses import dataclass
import datetime


@dataclass
class VoiceSession:
    user_id: int
    sk: str
    joined_at: datetime.datetime
    left_at: datetime.datetime | None = None
