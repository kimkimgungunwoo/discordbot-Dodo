"""오버워치 프로필 분석 AI 코멘트 생성기. bot.cogs.riot.ai_comment와 같은 패턴 —
Gemini 클라이언트는 bot.cogs.util 걸 재사용(AI 챗봇 기능과 동일 키/모델)."""
import os
from bot.cogs.util import client, MODEL_NAME, GEMINI_DISABLED

_DEFAULT_SYSTEM = (
    "너는 오버워치 전적을 분석하는 코치야. 숫자를 그대로 읽지 말고 의미를 해석해서 "
    "2~3문장으로 코멘트해. 정중한 한국어 존댓말로. 어색한 합성어나 API 필드명 느낌이 나는 "
    "표현 없이 자연스러운 한국어 게임 용어로 풀어서 말해."
)
_SYSTEM = os.getenv("overwatch_ai_prompt") or _DEFAULT_SYSTEM


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
        print(f"[OverwatchAI] 코멘트 생성 실패: {e}")
        return None


def build_analysis_prompt(profile, name: str) -> str:
    role_lines = "\n".join(
        f"- {r.role_kr}: 플레이 {r.hours_played}시간, 승률 {r.winrate}%, KDA {r.kda}, "
        f"10분당 데스 {r.deaths_per_10min}, 10분당 딜량 {r.damage_per_10min:,.0f}, "
        f"10분당 힐량 {r.healing_per_10min:,.0f}"
        for r in profile.role_stats
    ) or "역할별 기록 없음"

    rank_lines = "\n".join(
        f"- {r.role_kr}: {r.division_kr} {r.tier}티어" for r in profile.ranks
    ) or "경쟁전 랭크 없음(비공개 또는 미기록)"

    hero_lines = "\n".join(
        f"- {h.name}: {h.games_played}판({h.hours_played}시간), 승률 {h.winrate}%, KDA {h.kda}"
        for h in profile.top_heroes
    ) or "모스트 영웅 기록 없음"

    c = profile.combat
    combat_line = (
        f"누적 총 처치 {c.eliminations:,}, 마무리 {c.final_blows:,}, 솔로킬 {c.solo_kills:,}, "
        f"멀티킬 {c.multikills:,}, 오브젝트 처치 {c.objective_kills:,}, 환경 처치 {c.environmental_kills:,}"
    )
    b = profile.best
    best_line = (
        f"한 게임 최고 기록 — 최다 처치 {b.eliminations_most}, 최고 킬스트릭 {b.kill_streak_best}, "
        f"최고 멀티킬 {b.multikill_best}, 최다 솔로킬 {b.solo_kills_most}, "
        f"최다 딜량 {b.damage_most:,}, 최다 힐량 {b.healing_most:,}"
    )
    a = profile.assist_totals
    assist_line = (
        f"누적 어시스트 {a.total_assists:,} (방어 어시 {a.defensive_assists:,}, "
        f"공격 어시 {a.offensive_assists:,}, 정찰 어시 {a.recon_assists:,})"
    )

    total_role_sec = sum(r.time_played for r in profile.role_stats) or 1
    role_share_line = ", ".join(
        f"{r.role_kr} {round(r.time_played / total_role_sec * 100)}%" for r in profile.role_stats
    ) or "역할 비중 없음"

    return (
        f"{name}의 오버워치 전체 커리어 기록(빠른대전+경쟁전 합산, 총 {profile.hours_played}시간 플레이):\n"
        f"전체 {profile.games_played}판 중 {profile.games_won}승, 승률 {profile.winrate}%\n"
        f"공격 기여 — 10분당 처치 {profile.elims_per_10min}, 10분당 마무리 {profile.final_blows_per_10min}, "
        f"10분당 딜량 {profile.damage_per_10min:,.0f}, KDA {profile.kda}\n"
        f"생존 — 10분당 데스 {profile.deaths_per_10min}, 처치/데스 비율 {profile.elim_per_life}\n"
        f"지원 — 10분당 어시 {profile.assists_per_10min}, 10분당 힐량 {profile.healing_per_10min:,.0f}, {assist_line}\n"
        f"역할 비중: {role_share_line}\n"
        f"경쟁전 랭크:\n{rank_lines}\n"
        f"역할별 기록:\n{role_lines}\n"
        f"{combat_line}\n"
        f"{best_line}\n"
        f"모스트 영웅 Top3:\n{hero_lines}\n\n"
        "이 유저가 어떤 역할에 강점이 있는지, 역할 비중과 승률이 어떻게 맞물리는지, "
        "공격 기여/생존/지원 세 축의 밸런스는 어떤지(예: 처치는 잘하는데 생존력이 약한지, "
        "딜은 낮아도 어시스트로 팀을 받쳐주는지), 누적 전투 기록과 최고 기록이 보여주는 "
        "플레이 스타일(공격적/안정적, 솔로 캐리형/팀플레이형 등), 모스트 영웅 성적이 전체 성적과 "
        "비교해 어떤지 종합해서 코멘트해줘."
    )


def build_hero_analysis_prompt(heroes: list, name: str) -> str:
    lines = "\n".join(
        f"{i}. {h.name}: {h.games_played}판({h.hours_played}시간), 승률 {h.winrate}%, KDA {h.kda}"
        for i, h in enumerate(heroes, 1)
    ) or "영웅 기록 없음"

    return (
        f"{name}이(가) 플레이시간 기준으로 가장 많이 한 영웅 상위 {len(heroes)}개:\n{lines}\n\n"
        "이 유저의 영웅폭이 넓은지 좁은지(한두 영웅에 집중하는 원챔형인지, 여러 영웅을 고루 "
        "쓰는 폭넓은 유형인지), 선호하는 영웅들이 대체로 어떤 역할/유형에 몰려있는지, "
        "플레이시간이 많은 영웅일수록 승률도 높은 편인지 아니면 반대인지, 상위 목록에서 "
        "특히 잘하는 영웅과 반대로 시간 대비 아쉬운 영웅이 뭔지 종합해서 코멘트해줘."
    )


def build_hero_detail_prompt(hd, player_name: str) -> str:
    lines = [
        f"{player_name}의 {hd.hero_name}({hd.role_kr}) 기록: {hd.hours_played}시간 {hd.games_played}판, "
        f"승률 {hd.winrate}%, KDA {hd.kda}, 전체 대비 픽률 {hd.experience.percentage.get('hero_pick_rate', 0)}%, "
        f"역할 내 픽률 {hd.experience.percentage.get('hero_role_pick_rate', 0)}%"
    ]
    if "eliminations_per_life" in hd.survival.percentage:
        lines.append(
            f"처치/데스 {hd.survival.percentage['eliminations_per_life']}, "
            f"10분당 데스 {hd.survival.per10min.get('deaths_avg_per_10_min', 0)}"
        )
    if hd.attack.per10min:
        parts = ", ".join(f"{k} {v}" for k, v in hd.attack.per10min.items())
        lines.append(f"공격 지표(10분당): {parts}")
    if hd.support and hd.support.per10min:
        parts = ", ".join(f"{k} {v}" for k, v in hd.support.per10min.items())
        lines.append(f"지원 지표(10분당): {parts}")
    if hd.aim and hd.aim.percentage:
        parts = ", ".join(f"{k} {v}" for k, v in hd.aim.percentage.items())
        lines.append(f"정확도: {parts}")
    if hd.hero_specific.total:
        parts = ", ".join(f"{k} {v}" for k, v in hd.hero_specific.total.items())
        lines.append(f"{hd.hero_name} 고유 누적 기록: {parts}")

    return (
        "\n".join(lines) + "\n\n"
        f"이 유저가 {hd.hero_name}를 얼마나 잘 다루는지 코멘트해줘. 강점(뛰어난 처치력/생존력/"
        "서포팅/정확도 등)과 약점을 구체적으로 짚고, 위에 나온 이 영웅 고유 스킬 활용도까지 "
        "포함해서 2~3문장으로."
    )
