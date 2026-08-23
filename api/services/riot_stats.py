"""
최근 N판 집계 분석 모듈.
MatchResult 리스트를 받아 종합 성적·캐리력·팀운·트렌드·포지션/챔프를 집계한다.
"""

from __future__ import annotations
from collections import Counter
from dataclasses import dataclass

from api.services.riot_analysis import (
    GOOD_GRADES, BAD_GRADES,
    WIN_CARRY, WIN_GOOD, WIN_NORMAL, WIN_BAD,
    LOSE_CARRY, LOSE_GOOD, LOSE_NORMAL, LOSE_BAD,
)

# riot_api의 POSITION_KR과 동기화
_POSITION_KR = {
    "TOP": "탑", "JUNGLE": "정글", "MIDDLE": "미드",
    "BOTTOM": "원딜", "UTILITY": "서포터",
}


@dataclass
class MatchStats:
    total: int
    wins: int

    # 종합 성적
    avg_kda: float
    avg_kp: float
    avg_cs_per_min: float
    avg_damage: int
    avg_objectives: float     # 드래곤/바론/전령 관여 횟수 평균 (주로 정글 지표)
    avg_vision_score: float   # 시야점수 평균 (주로 서포터 지표)
    avg_camps: float          # 정글 몹(캠프) 처치 수 평균 (주로 정글 지표)

    # 캐리력
    avg_damage_share: float
    avg_dmg_rank: float
    carry_count: int    # 캐리/혼자함
    good_count: int     # 활약/선방
    normal_count: int   # 평범
    bad_count: int      # 발목/트롤

    # 팀운
    good_game_total: int
    good_game_wins: int
    bad_game_total: int
    bad_game_wins: int
    carry_loss: int     # 잘했는데 진 판
    bad_win: int        # 못했는데 이긴 판

    # 트렌드 (최근 절반 vs 이전 절반)
    recent_n: int
    recent_wins: int
    prev_wins: int
    recent_avg_kda: float
    prev_avg_kda: float

    # 점수
    avg_score: float

    # 포지션
    main_position: str
    main_pos_total: int
    main_pos_wins: int

    # 챔프 Top 3: (이름, 판수, 승리수)
    top_champs: list[tuple[str, int, int]]

    @property
    def win_rate(self) -> int:
        return round(self.wins / max(self.total, 1) * 100)

    @property
    def good_win_rate(self) -> int:
        return round(self.good_game_wins / max(self.good_game_total, 1) * 100)

    @property
    def bad_win_rate(self) -> int:
        return round(self.bad_game_wins / max(self.bad_game_total, 1) * 100)

    @property
    def prev_n(self) -> int:
        return self.total - self.recent_n

    @property
    def recent_win_rate(self) -> int:
        return round(self.recent_wins / max(self.recent_n, 1) * 100)

    @property
    def prev_win_rate(self) -> int:
        return round(self.prev_wins / max(self.prev_n, 1) * 100) if self.prev_n else 0

    @property
    def main_pos_win_rate(self) -> int:
        return round(self.main_pos_wins / max(self.main_pos_total, 1) * 100)

    @property
    def trend_arrow(self) -> str:
        if self.total < 6:
            return ""
        diff = self.recent_wins - self.prev_wins
        if diff >= 2:
            return "📈 상승 중"
        if diff <= -2:
            return "📉 하락 중"
        return "➡️ 유지 중"

    @property
    def luck_score(self) -> str:
        """팀운 한줄 평가"""
        net = self.bad_win - self.carry_loss
        if net >= 2:
            return "🍀 팀운 매우 좋음"
        if net == 1:
            return "🍀 팀운 좋음"
        if net == 0:
            return "😐 팀운 보통"
        if net == -1:
            return "😤 팀운 나쁨"
        return "😤 팀운 매우 나쁨"


def analyze_matches(matches: list) -> MatchStats | None:
    from api.services.riot_api import MatchResult
    if not matches:
        return None

    total = len(matches)
    wins  = sum(1 for m in matches if m.win)

    # ── 종합 성적 ──────────────────────────────────────
    avg_kda        = round(sum(m.kda for m in matches) / total, 2)
    avg_kp         = round(sum(m.kill_participation for m in matches) / total, 1)
    avg_cs_per_min = round(
        sum(m.cs / max(m.duration / 60, 1) for m in matches) / total, 1
    )
    avg_damage = round(sum(m.damage for m in matches) / total)
    avg_objectives = round(sum(m.objectives for m in matches) / total, 1)
    avg_vision_score = round(sum(m.vision_score for m in matches) / total, 1)
    avg_camps = round(sum(m.camps for m in matches) / total, 1)

    # ── 캐리력 ─────────────────────────────────────────
    avg_score        = round(sum(m.score for m in matches) / total, 1)
    avg_damage_share = round(sum(m.damage_share for m in matches) / total, 1)
    avg_dmg_rank     = round(sum(m.dmg_rank for m in matches) / total, 1)

    carry_count  = sum(1 for m in matches if m.grade in {WIN_CARRY,  LOSE_CARRY})
    good_count   = sum(1 for m in matches if m.grade in {WIN_GOOD,   LOSE_GOOD})
    normal_count = sum(1 for m in matches if m.grade in {WIN_NORMAL, LOSE_NORMAL})
    bad_count    = sum(1 for m in matches if m.grade in {WIN_BAD,    LOSE_BAD})

    # ── 팀운 ───────────────────────────────────────────
    good_games = [m for m in matches if m.grade in GOOD_GRADES]
    bad_games  = [m for m in matches if m.grade in BAD_GRADES]

    good_game_wins = sum(1 for m in good_games if m.win)
    bad_game_wins  = sum(1 for m in bad_games  if m.win)
    carry_loss     = sum(1 for m in good_games if not m.win)
    bad_win        = sum(1 for m in bad_games  if m.win)

    # ── 트렌드 (최근 절반 vs 이전 절반, 최소 5판씩) ────────
    recent_n = max(total // 2, min(5, total))
    recent = matches[:recent_n]
    prev   = matches[recent_n:] if total >= 6 else []

    recent_wins    = sum(1 for m in recent if m.win)
    prev_wins      = sum(1 for m in prev   if m.win)
    recent_avg_kda = round(sum(m.kda for m in recent) / len(recent), 2)
    prev_avg_kda   = round(sum(m.kda for m in prev)   / len(prev),   2) if prev else 0.0

    # ── 포지션 ─────────────────────────────────────────
    pos_results: dict[str, list[bool]] = {}
    for m in matches:
        p = m.position or "NONE"
        pos_results.setdefault(p, []).append(m.win)

    main_pos       = max(pos_results, key=lambda p: len(pos_results[p]))
    main_pos_total = len(pos_results[main_pos])
    main_pos_wins  = sum(pos_results[main_pos])

    # ── 챔프 Top 3 ────────────────────────────────────
    champ_results: dict[str, list[bool]] = {}
    for m in matches:
        champ_results.setdefault(m.champion_name, []).append(m.win)

    top_champs = sorted(
        [(name, len(r), sum(r)) for name, r in champ_results.items()],
        key=lambda x: x[1], reverse=True
    )[:3]

    return MatchStats(
        total=total, wins=wins,
        avg_kda=avg_kda, avg_kp=avg_kp,
        avg_cs_per_min=avg_cs_per_min, avg_damage=avg_damage, avg_objectives=avg_objectives,
        avg_vision_score=avg_vision_score, avg_camps=avg_camps,
        avg_damage_share=avg_damage_share, avg_dmg_rank=avg_dmg_rank,
        avg_score=avg_score,
        carry_count=carry_count, good_count=good_count,
        normal_count=normal_count, bad_count=bad_count,
        good_game_total=len(good_games), good_game_wins=good_game_wins,
        bad_game_total=len(bad_games),   bad_game_wins=bad_game_wins,
        carry_loss=carry_loss, bad_win=bad_win,
        recent_n=recent_n, recent_wins=recent_wins, prev_wins=prev_wins,
        recent_avg_kda=recent_avg_kda, prev_avg_kda=prev_avg_kda,
        main_position=main_pos, main_pos_total=main_pos_total,
        main_pos_wins=main_pos_wins,
        top_champs=top_champs,
    )
