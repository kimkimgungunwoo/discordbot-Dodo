"""
포지션 보정 등급 산정 모듈.
match participant 딕셔너리를 받아 팀원 대비 수행도를 등급으로 반환한다.
"""

# 포지션별 기준 지표
_POSITION_METRIC = {
    "TOP":     "damage",
    "JUNGLE":  "kp",
    "MIDDLE":  "damage",
    "BOTTOM":  "damage",
    "UTILITY": "vision",
}

# 포지션별 데스 허용 한계 (초과 시 등급 상한 제한)
_DEATH_CAP = {
    "UTILITY": 7,
    "TOP":     5,
    "JUNGLE":  5,
    "MIDDLE":  5,
    "BOTTOM":  5,
}

# 승리 등급
WIN_CARRY  = "🔥 캐리"
WIN_GOOD   = "✅ 활약"
WIN_NORMAL = "😐 평범"
WIN_BAD    = "💀 발목"

# 패배 등급
LOSE_CARRY  = "🔥 혼자함"
LOSE_GOOD   = "✅ 선방"
LOSE_NORMAL = "😐 평범"
LOSE_BAD    = "🐀 트롤"


def _metric_value(participant: dict, metric: str, team_kills: int) -> float:
    if metric == "damage":
        return participant.get("totalDamageDealtToChampions", 0)
    if metric == "kp":
        k = participant["kills"] + participant["assists"]
        return k / max(team_kills, 1) * 100
    if metric == "vision":
        return participant.get("visionScore", 0)
    return 0


def grade_player(
    me: dict,
    all_participants: list[dict],
    position: str,
    win: bool,
) -> str:
    """
    포지션 보정 후 팀원 대비 등급을 반환한다.

    승리: 🔥 캐리 / ✅ 활약 / 😐 평범 / 💀 발목
    패배: 🔥 혼자함 / ✅ 선방 / 😐 평범 / 🐀 트롤
    """
    team       = [p for p in all_participants if p["teamId"] == me["teamId"]]
    team_kills = sum(p["kills"] for p in team)
    metric     = _POSITION_METRIC.get(position, "damage")

    my_val    = _metric_value(me, metric, team_kills)
    team_vals = [_metric_value(p, metric, team_kills) for p in team]
    team_avg  = sum(team_vals) / len(team_vals) if team_vals else 1

    my_rank   = sum(1 for v in team_vals if v > my_val) + 1
    deaths    = me.get("deaths", 0)
    death_cap = _DEATH_CAP.get(position, 5)
    over_died = deaths > death_cap

    g_carry, g_good, g_normal, g_bad = (
        (WIN_CARRY,  WIN_GOOD,  WIN_NORMAL,  WIN_BAD)  if win else
        (LOSE_CARRY, LOSE_GOOD, LOSE_NORMAL, LOSE_BAD)
    )

    if my_rank == 1 and my_val >= team_avg * 1.6 and deaths <= 3:
        return g_carry
    if my_val >= team_avg * 1.15 and not over_died:
        return g_good
    if my_val < team_avg * 0.8 or over_died:
        return g_bad
    return g_normal
