import datetime

KST = datetime.timezone(datetime.timedelta(hours=9))
WEEKDAY = "월화수목금토일"


def now_kst() -> datetime.datetime:
    return datetime.datetime.now(KST).replace(tzinfo=None)


def format_when(dt: datetime.datetime) -> str:
    return f"{dt.month}월 {dt.day}일 ({WEEKDAY[dt.weekday()]}) {dt:%H:%M}"
