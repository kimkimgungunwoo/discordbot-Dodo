from dataclasses import dataclass


@dataclass
class ChatHourly:
    hour: int
    message_count: int
