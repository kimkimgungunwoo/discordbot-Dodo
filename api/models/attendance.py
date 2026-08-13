from dataclasses import dataclass
import datetime


@dataclass
class Attendance:
    user_id: int
    attendance_date: datetime.date
    point: int
    created_at: datetime.datetime | None = None
