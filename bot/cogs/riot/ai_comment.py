"""
롤 카드(전적/전적분석/게임분석) 공통 AI 코멘트 생성기.
Gemini 클라이언트는 bot.cogs.util 걸 그대로 재사용한다 (AI 챗봇 기능과 동일 키/모델).

포지션별로 "이 지표는 언급하지 마" 식으로 지시만 하면 모델이 그래도 눈앞에 있는 숫자를
근거로 코멘트하는 경우가 있었다. 그래서 아예 포지션별 핵심 지표만 프롬프트에 넣는다:
  탑: 라인전(CS)
  정글: 오브젝트 관여, 킬관여율, 정글 캠프 수
  미드: 라인전(CS), KDA
  원딜: 라인전(CS), 딜량
  서폿: 킬관여율, 라인전(CS), 시야점수
"라인전"에 해당하는 실제 "상대 라이너 대비 CS 격차" 데이터는 없어서 CS 총량으로 대체한다.
"""
import os
from bot.cogs.util import client, MODEL_NAME, GEMINI_DISABLED
from api.services.riot_api import POSITION_KR

_DEFAULT_SYSTEM = (
    "너는 리그오브레전드 전적을 분석하는 코치야. 숫자를 그대로 읽지 말고 의미를 해석해서 "
    "2~3문장으로 코멘트해. 정중한 한국어 존댓말로. 프롬프트에 이미 그 포지션에서 중요한 "
    "지표만 골라서 줄 테니, 주어진 지표 중심으로 해석해줘."
)
_SYSTEM = os.getenv("riot_ai_prompt") or _DEFAULT_SYSTEM


async def generate_comment(prompt: str) -> str | None:
    """실패하거나 AI 기능이 꺼져있으면 None — 호출부는 그때 코멘트 섹션을 그냥 생략하면 된다."""
    if GEMINI_DISABLED:
        return None
    try:
        response = await client.aio.models.generate_content(
            model=MODEL_NAME,
            contents=f"{_SYSTEM}\n\n{prompt}",
        )
        return response.text.strip()
    except Exception as e:
        print(f"[RiotAI] 코멘트 생성 실패: {e}")
        return None


# ── 포지션별 핵심 지표 (per-game: MatchResult / ParticipantSummary 공통 필드만 사용) ──

def _focus_line(pos: str, *, cs, kda, kp, damage, vision, objectives, camps) -> str:
    if pos == "TOP":
        return f"CS {cs}"
    if pos == "JUNGLE":
        return f"오브젝트 관여 {objectives}회, 킬관여율 {kp}%, 정글 캠프 {camps}마리"
    if pos == "MIDDLE":
        return f"CS {cs}, KDA {kda}"
    if pos == "BOTTOM":
        return f"CS {cs}, 딜량 {damage}"
    if pos == "UTILITY":
        return f"킬관여율 {kp}%, CS {cs}, 시야점수 {vision}"
    return f"CS {cs}, KDA {kda}"  # 포지션 미상 폴백 — MIDDLE과 동일 취급


def _match_line(i: int, m) -> str:
    focus = _focus_line(
        m.position, cs=m.cs, kda=m.kda, kp=m.kill_participation,
        damage=m.damage_str, vision=m.vision_score,
        objectives=m.objectives, camps=m.camps,
    )
    return (
        f"{i}. {'승' if m.win else '패'} {m.champion_name}({m.position_kr}) "
        f"{m.score}점 {m.grade} — {focus} — {m.duration_str}"
    )


def build_history_prompt(matches: list, game_name: str) -> str:
    lines = [_match_line(i, m) for i, m in enumerate(matches, 1)]
    return (
        f"{game_name}의 최근 {len(matches)}게임 전적 (1번이 가장 최근 게임, 괄호 안은 포지션):\n"
        + "\n".join(lines)
        + "\n\n개별 게임을 하나씩 평가하지 말고, 이 게임들 전체에서 보이는 흐름/경향성"
        "(성장세인지 하락세인지, 반복되는 문제나 패턴, 특정 챔프·포지션에서의 경향)"
        " 위주로 코멘트해줘."
    )


def build_stats_prompt(stats, game_name: str) -> str:
    pos_kr = POSITION_KR.get(stats.main_position, stats.main_position)
    focus = _focus_line(
        stats.main_position, cs=f"{stats.avg_cs_per_min}/분", kda=stats.avg_kda,
        kp=f"{stats.avg_kp}", damage=f"{stats.avg_damage:,}",
        vision=stats.avg_vision_score, objectives=stats.avg_objectives, camps=stats.avg_camps,
    )
    return (
        f"{game_name}의 최근 {stats.total}게임 종합 분석 (주 포지션: {pos_kr}, "
        f"{stats.main_pos_total}판 {stats.main_pos_win_rate}%):\n"
        f"승률 {stats.win_rate}% ({stats.wins}승 {stats.total - stats.wins}패), "
        f"포지션 보정 평균 점수 {stats.avg_score}점\n"
        f"이 포지션 핵심 지표 평균 — {focus}\n"
        f"등급 분포: 캐리/혼자함 {stats.carry_count}판, 활약/선방 {stats.good_count}판, "
        f"평범 {stats.normal_count}판, 발목/트롤 {stats.bad_count}판\n"
        f"팀운: {stats.luck_score} (잘한 판인데 짐 {stats.carry_loss}판, "
        f"못한 판인데 버스탄 {stats.bad_win}판)\n"
        f"트렌드: {stats.trend_arrow or '데이터 부족'} "
        f"(최근 {stats.recent_n}판 {stats.recent_win_rate}% vs 이전 {stats.prev_n}판 {stats.prev_win_rate}%)\n\n"
        "총점과 승률을 중심으로, 다른 요소들(팀운/트렌드/포지션 등)이 그 승률에 "
        "어떻게 영향을 줬는지 종합해서 코멘트해줘."
    )


def build_game_analysis_prompt(detail, game_name: str) -> str:
    me = detail.me
    my = detail.my_team_totals
    en = detail.enemy_team_totals
    kp = round((me.kills + me.assists) / max(my.kills, 1) * 100)
    focus = _focus_line(
        me.position, cs=me.cs, kda=me.kda, kp=kp, damage=f"{me.damage:,}",
        vision=me.vision_score, objectives=me.objectives, camps=me.camps,
    )
    my_line = " / ".join(
        f"{p.summoner_name}({p.position_kr} {p.champion_name}) {p.score}점 "
        f"{p.kills}/{p.deaths}/{p.assists}"
        for p in detail.my_team
    )
    en_line = " / ".join(
        f"{p.summoner_name}({p.position_kr} {p.champion_name}) {p.score}점 "
        f"{p.kills}/{p.deaths}/{p.assists}"
        for p in detail.enemy_team
    )
    return (
        f"이 게임에서 분석 대상은 {game_name}({me.position_kr} {me.champion_name})이고, "
        f"결과는 {'승리' if me.win else '패배'}, 점수 {me.score}점({me.grade})입니다.\n"
        f"{game_name}의 이 포지션 핵심 지표 — {focus}\n"
        f"팀 합계 비교 — 우리팀 킬{my.kills}/골드{my.gold:,}/드래곤{my.dragons}/바론{my.barons}/타워{my.towers} "
        f"vs 상대팀 킬{en.kills}/골드{en.gold:,}/드래곤{en.dragons}/바론{en.barons}/타워{en.towers}\n"
        f"우리팀: {my_line}\n"
        f"상대팀: {en_line}\n"
        f"이 게임의 에이스: {detail.ace.summoner_name}({detail.ace.score}점), "
        f"트롤: {detail.troll.summoner_name}({detail.troll.score}점)\n\n"
        f"{game_name}이(가) 이 판에서 실제로 어떤 역할을 했는지, 팀 전체 상황과 "
        "비교했을 때 잘한 점/아쉬운 점을 구체적으로 짚어서 코멘트해줘."
    )
