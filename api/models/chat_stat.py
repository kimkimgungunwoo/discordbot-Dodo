from dataclasses import dataclass
import datetime


@dataclass
class ChatStat:
    user_id: int
    message_count: int
    last_message_at: datetime.datetime | None = None
