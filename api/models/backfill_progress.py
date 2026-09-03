from dataclasses import dataclass


@dataclass
class BackfillProgress:
    channel_id: int
    cursor_id: int | None
    done: bool
