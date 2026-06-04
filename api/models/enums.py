import enum


class GameType(str, enum.Enum):
    chamchamcham = "chamchamcham"
    rsp = "rsp"


class GambleType(str, enum.Enum):
    sniffling = "sniffling"
    racing = "racing"
    slotmachine = "slotmachine"


class PointReason(str, enum.Enum):
    attendance = "attendance"
    game_win = "game_win"
    game_lose = "game_lose"
    gamble_win = "gamble_win"
    gamble_lose = "gamble_lose"
    admin = "admin"
