"""
포지션 보정 점수 및 등급 산정 모듈.

산정 과정:
  1. 팀원 각자 포지션별 기여 점수 산출 (0–70)
     - 핵심·보조·KDA 지표 + 포지션 특화 지표(라인전 CS차/오브젝트) + 상대 라이너 골드차를
       포지션 기댓값 또는 격차 기준으로 정규화해 가중 합산
  2. 기여 점수 기준 팀 내 순위 → 순위 보너스 (+0~30)
  3. 포지션 보정 데스 패널티 (–0~15)
"""

# ── 포지션별 기댓값 (비율 정규화 지표용) ────────────────────────────
# 일반적인 한 게임의 지표 평균치 (정규화 기준)
_EXP: dict[str, dict] = {
    "TOP":     {"damage": 15000, "kp": 55,  "kda": 3.0},
    "JUNGLE":  {"damage": 12000, "kp": 65,  "kda": 3.0, "objectives": 3},
    "MIDDLE":  {"damage": 18000, "kp": 55,  "kda": 3.5},
    "BOTTOM":  {"damage": 22000, "kp": 50,  "kda": 4.0},
    "UTILITY": {"vision": 35,   "kp": 65,  "kda": 2.0},
}
_EXP_DEFAULT = _EXP["MIDDLE"]

# 상대 라이너 대비 격차 지표(gold_diff/laning)는 기댓값이 아니라 이 폭(±cap)을 0~1로 매핑한다.
# ponytail: 실측 데이터 없이 잡은 초기값 — 실제 매치로 체감 확인 후 조정할 것.
_GOLD_DIFF_CAP = 3000  # 골드 격차 ±3000 → 정규화 0.0~1.0, 대등하면 0.5
_CS_DIFF_CAP = 40      # 라인전 CS 격차 ±40

# ── 포지션별 지표 가중치 — (metric, weight) 리스트, 합은 항상 1.0 ────
# damage/kp/kda/vision/objectives: 포지션 기댓값 대비 정규화
# laning(=CS차)/gold_diff: 같은 포지션 상대 라이너 대비 격차로 정규화
# - 원딜: 딜량 비중을 가장 높게
# - 정글: 오브젝트 관여(용/전령/바론)를 별도 지표로
# - 탑/미드: 라인전(CS차) 지표 추가, 미드는 딜량도 함께 중시
# - 전 포지션 공통: 상대 라이너와의 골드차 반영
_W: dict[str, list[tuple[str, float]]] = {
    "TOP":     [("damage", .35), ("kp", .15), ("kda", .20), ("laning", .20), ("gold_diff", .10)],
    "JUNGLE":  [("kp", .30), ("damage", .15), ("kda", .20), ("objectives", .25), ("gold_diff", .10)],
    "MIDDLE":  [("damage", .35), ("kp", .15), ("kda", .20), ("laning", .15), ("gold_diff", .15)],
    "BOTTOM":  [("damage", .45), ("kp", .15), ("kda", .20), ("gold_diff", .20)],
    "UTILITY": [("vision", .30), ("kp", .30), ("kda", .20), ("gold_diff", .20)],
}
_W_DEFAULT = _W["MIDDLE"]

# ── 팀 내 순위 → 보너스 (30점 만점) ──────────────────────────────
_RANK_BONUS = {1: 30, 2: 23, 3: 16, 4: 9, 5: 2}

# ── 포지션별 데스 패널티 (1개당 감점, 최대 15점) ─────────────────
# 예전엔 미드/원딜 2.5 vs 정글/서폿 1.5로 격차가 커서, 다른 지표가 전부 동일해도
# 정글/서폿이 항상 5점 가까이 유리했다 (서폿 보정 과함 체감의 원인 중 하나) — 격차를 줄임.
_DEATH_W = {
    "TOP": 2.0, "JUNGLE": 1.7, "MIDDLE": 2.0, "BOTTOM": 2.0, "UTILITY": 1.7,
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
    if metric == "objectives":
        c = p.get("challenges") or {}
        return c.get("dragonTakedowns", 0) + c.get("baronTakedowns", 0) + c.get("riftHeraldTakedowns", 0)
    return 0


def _norm(val: float, metric: str, pos: str) -> float:
    """실제값을 포지션 기댓값 대비 비율로 정규화 (0.0–1.0, 최대 2배까지 인정)."""
    exp_map = _EXP.get(pos, _EXP_DEFAULT)
    exp_val = exp_map.get(metric) or _EXP_DEFAULT.get(metric, 1)
    return min(val / max(exp_val, 1), 2.0) / 2.0


def _diff_norm(diff: float, cap: float) -> float:
    """상대 라이너 대비 격차를 0.0(±cap만큼 뒤짐)~1.0(±cap만큼 앞섬)으로 정규화, 대등하면 0.5."""
    return min(max((diff + cap) / (2 * cap), 0.0), 1.0)


def _get_pos(p: dict) -> str:
    pos = p.get("individualPosition") or p.get("teamPosition") or ""
    return pos if pos not in ("Invalid", "NONE", "") else "MIDDLE"


def _lane_opponent(me: dict, all_participants: list[dict], pos: str) -> dict | None:
    """같은 포지션의 상대팀 참가자를 찾는다 (없으면 None → 격차 지표는 대등 취급)."""
    for p in all_participants:
        if p["teamId"] != me["teamId"] and _get_pos(p) == pos:
            return p
    return None


def _gold_diff(me: dict, opponent: dict | None) -> float:
    if opponent is None:
        return 0
    return me.get("goldEarned", 0) - opponent.get("goldEarned", 0)


def _cs(p: dict) -> int:
    return p.get("totalMinionsKilled", 0) + p.get("neutralMinionsKilled", 0)


def _cs_diff(me: dict, opponent: dict | None) -> float:
    if opponent is None:
        return 0
    return _cs(me) - _cs(opponent)


def _perf_score(p: dict, pos: str, team_kills: int, all_participants: list[dict]) -> float:
    """포지션별 기여 점수 (0–70). 팀 내 순위 미반영."""
    weights = _W.get(pos, _W_DEFAULT)
    opponent = _lane_opponent(p, all_participants, pos)

    total = 0.0
    for metric, weight in weights:
        if metric == "gold_diff":
            score = _diff_norm(_gold_diff(p, opponent), _GOLD_DIFF_CAP)
        elif metric == "laning":
            score = _diff_norm(_cs_diff(p, opponent), _CS_DIFF_CAP)
        else:
            score = _norm(_metric_val(p, metric, team_kills), metric, pos)
        total += score * weight
    return total * 70


def score_player(me: dict, all_participants: list[dict], position: str) -> int:
    """0–100 점수 산정."""
    team       = [p for p in all_participants if p["teamId"] == me["teamId"]]
    team_kills = sum(p.get("kills", 0) for p in team)

    # 팀원 전체 기여 점수 (각자 포지션 적용)
    all_perfs = [_perf_score(p, _get_pos(p), team_kills, all_participants) for p in team]

    # 본인 기여 점수는 확정 포지션으로 덮어씀
    my_idx = next((i for i, p in enumerate(team) if p is me), 0)
    my_perf = _perf_score(me, position, team_kills, all_participants)
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


def _demo():
    for pos, weights in _W.items():
        assert abs(sum(w for _, w in weights) - 1.0) < 1e-9, f"{pos} 가중치 합이 1.0이 아님"

    positions = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]

    def _make(team_id, pos, **stats):
        p = {"teamId": team_id, "individualPosition": pos, "kills": 5, "deaths": 5,
             "assists": 5, "totalDamageDealtToChampions": 15000, "visionScore": 20,
             "goldEarned": 10000, "totalMinionsKilled": 150, "neutralMinionsKilled": 0,
             "win": True, "challenges": {}}
        p.update(stats)
        return p

    team1 = [_make(100, pos) for pos in positions]
    team2 = [_make(200, pos) for pos in positions]
    match = team1 + team2

    # 데스 패널티 격차가 예전(2.5 vs 1.5 = 1.0)만큼 벌어져 있으면 안 된다 — 서폿/정글이
    # 다른 지표 동일해도 자동으로 유리해지던 원인이었던 부분의 재발 방지.
    assert max(_DEATH_W.values()) - min(_DEATH_W.values()) <= 0.5, "데스 패널티 격차가 다시 벌어짐"

    baseline = score_player(team1[0], match, "TOP")
    assert 0 <= baseline <= 100

    # 딜량을 2배로 올리면 점수가 내려가면 안 된다.
    top = _make(100, "TOP", totalDamageDealtToChampions=30000)
    rest = [_make(100, p) for p in positions if p != "TOP"]
    hi_dmg_score = score_player(top, [top] + rest + team2, "TOP")
    assert hi_dmg_score >= baseline, "딜량이 오른 TOP 점수가 baseline보다 낮음"

    # 상대보다 골드가 3000 앞서면 점수가 올라야 한다 (전 포지션 공통 gold_diff 가중치 검증).
    adc_base = score_player(team1[3], match, "BOTTOM")
    adc = _make(100, "BOTTOM", goldEarned=13000)
    adc_hi_gold = score_player(adc, [adc] + [p for p in team1 if p["individualPosition"] != "BOTTOM"] + team2, "BOTTOM")
    assert adc_hi_gold >= adc_base, "골드 앞선 원딜 점수가 대등할 때보다 낮음"

    # 오브젝트 관여를 늘리면 정글 점수가 올라야 한다.
    jg_base = score_player(team1[1], match, "JUNGLE")
    jg = _make(100, "JUNGLE", challenges={"dragonTakedowns": 3, "baronTakedowns": 1, "riftHeraldTakedowns": 1})
    jg_hi_obj = score_player(jg, [jg] + [p for p in team1 if p["individualPosition"] != "JUNGLE"] + team2, "JUNGLE")
    assert jg_hi_obj >= jg_base, "오브젝트 관여가 늘어난 정글 점수가 baseline보다 낮음"

    print("ok")


if __name__ == "__main__":
    _demo()
