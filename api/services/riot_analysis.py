"""
포지션 보정 점수 및 등급 산정 모듈.

산정 과정:
  1. 팀원 각자 포지션별 기여 점수 산출 (0–70)
     - 핵심·보조·KDA 지표를 포지션 기댓값으로 정규화해 가중 합산
  2. 기여 점수 기준 팀 내 순위 → 순위 보너스 (+0~30)
  3. 포지션 보정 데스 패널티 (–0~15)
"""

# ── 포지션별 기댓값 ────────────────────────────────────────────────
# 일반적인 한 게임의 지표 평균치 (정규화 기준)
_EXP: dict[str, dict] = {
    "TOP":     {"damage": 15000, "kp": 55,  "kda": 3.0},
    "JUNGLE":  {"damage": 12000, "kp": 65,  "kda": 3.0},
    "MIDDLE":  {"damage": 18000, "kp": 55,  "kda": 3.5},
    "BOTTOM":  {"damage": 22000, "kp": 50,  "kda": 4.0},
    "UTILITY": {"vision": 35,   "kp": 65,  "kda": 2.0},
}
_EXP_DEFAULT = _EXP["MIDDLE"]

# ── 포지션별 지표 가중치 ───────────────────────────────────────────
# p1: 핵심 지표  p2: 보조 지표  p3: KDA
# p1_w + p2_w + p3_w = 1.0
_W: dict[str, dict] = {
    "TOP":     {"p1": "damage", "p2": "kp",     "p3": "kda", "p1_w": 0.50, "p2_w": 0.25, "p3_w": 0.25},
    "JUNGLE":  {"p1": "kp",    "p2": "damage",  "p3": "kda", "p1_w": 0.45, "p2_w": 0.25, "p3_w": 0.30},
    "MIDDLE":  {"p1": "damage","p2": "kp",      "p3": "kda", "p1_w": 0.50, "p2_w": 0.20, "p3_w": 0.30},
    "BOTTOM":  {"p1": "damage","p2": "kp",      "p3": "kda", "p1_w": 0.55, "p2_w": 0.15, "p3_w": 0.30},
    "UTILITY": {"p1": "vision","p2": "kp",      "p3": "kda", "p1_w": 0.45, "p2_w": 0.35, "p3_w": 0.20},
}
_W_DEFAULT = _W["MIDDLE"]

# ── 팀 내 순위 → 보너스 (30점 만점) ──────────────────────────────
_RANK_BONUS = {1: 30, 2: 23, 3: 16, 4: 9, 5: 2}

# ── 포지션별 데스 패널티 (1개당 감점, 최대 15점) ─────────────────
_DEATH_W = {
    "TOP": 2.0, "JUNGLE": 1.5, "MIDDLE": 2.5, "BOTTOM": 2.5, "UTILITY": 1.5,
}

# ── 등급 레이블 ───────────────────────────────────────────────────
WIN_CARRY   = "🔥 캐리"
WIN_GOOD    = "✅ 활약"
WIN_NORMAL  = "😐 평범"
WIN_BAD     = "💀 발목"
LOSE_CARRY  = "🔥 혼자함"
LOSE_GOOD   = "✅ 선방"
LOSE_NORMAL = "😐 평범"
LOSE_BAD    = "🐀 트롤"

GOOD_GRADES = {WIN_CARRY, WIN_GOOD, LOSE_CARRY, LOSE_GOOD}
BAD_GRADES  = {WIN_BAD, LOSE_BAD}


def _metric_val(p: dict, metric: str, team_kills: int) -> float:
    if metric == "damage":
        return p.get("totalDamageDealtToChampions", 0)
    if metric == "kp":
        return (p.get("kills", 0) + p.get("assists", 0)) / max(team_kills, 1) * 100
    if metric == "kda":
        return (p.get("kills", 0) + p.get("assists", 0)) / max(p.get("deaths", 1), 1)
    if metric == "vision":
        return p.get("visionScore", 0)
    return 0


def _norm(val: float, metric: str, pos: str) -> float:
    """실제값을 포지션 기댓값 대비 비율로 정규화 (0.0–1.0, 최대 2배까지 인정)."""
    exp_map = _EXP.get(pos, _EXP_DEFAULT)
    exp_val = exp_map.get(metric) or _EXP_DEFAULT.get(metric, 1)
    return min(val / max(exp_val, 1), 2.0) / 2.0


def _perf_score(p: dict, pos: str, team_kills: int) -> float:
    """포지션별 기여 점수 (0–70). 팀 내 순위 미반영."""
    w = _W.get(pos, _W_DEFAULT)
    v1 = _metric_val(p, w["p1"], team_kills)
    v2 = _metric_val(p, w["p2"], team_kills)
    v3 = _metric_val(p, w["p3"], team_kills)
    return (
        _norm(v1, w["p1"], pos) * w["p1_w"]
        + _norm(v2, w["p2"], pos) * w["p2_w"]
        + _norm(v3, w["p3"], pos) * w["p3_w"]
    ) * 70


def _get_pos(p: dict) -> str:
    pos = p.get("individualPosition") or p.get("teamPosition") or ""
    return pos if pos not in ("Invalid", "NONE", "") else "MIDDLE"


def score_player(me: dict, all_participants: list[dict], position: str) -> int:
    """0–100 점수 산정."""
    team       = [p for p in all_participants if p["teamId"] == me["teamId"]]
    team_kills = sum(p.get("kills", 0) for p in team)

    # 팀원 전체 기여 점수 (각자 포지션 적용)
    all_perfs = [_perf_score(p, _get_pos(p), team_kills) for p in team]

    # 본인 기여 점수는 확정 포지션으로 덮어씀
    my_idx = next((i for i, p in enumerate(team) if p is me), 0)
    my_perf = _perf_score(me, position, team_kills)
    all_perfs[my_idx] = my_perf

    # 팀 내 순위 (높을수록 좋은 등수)
    my_rank    = sum(1 for s in all_perfs if s > my_perf) + 1
    rank_bonus = _RANK_BONUS.get(min(my_rank, 5), 2)

    # 데스 패널티
    death_penalty = min(me.get("deaths", 0) * _DEATH_W.get(position, 2.0), 15)

    return max(0, min(100, round(my_perf + rank_bonus - death_penalty)))


def grade_from_score(score: int, win: bool) -> str:
    g_carry, g_good, g_normal, g_bad = (
        (WIN_CARRY,  WIN_GOOD,  WIN_NORMAL,  WIN_BAD)  if win else
        (LOSE_CARRY, LOSE_GOOD, LOSE_NORMAL, LOSE_BAD)
    )
    if score >= 75:
        return g_carry
    if score >= 55:
        return g_good
    if score >= 35:
        return g_normal
    return g_bad


def score_and_grade(
    me: dict,
    all_participants: list[dict],
    position: str,
    win: bool,
) -> tuple[int, str]:
    score = score_player(me, all_participants, position)
    return score, grade_from_score(score, win)
