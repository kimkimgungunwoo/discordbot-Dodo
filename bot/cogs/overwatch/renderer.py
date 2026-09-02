"""HTML 템플릿 → Playwright → PNG 렌더러 (오버워치 프로필 카드)."""

import io
from pathlib import Path
from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.async_api import async_playwright

_TEMPLATES_DIR = Path(__file__).parent / "templates"
_RIOT_TEMPLATES_DIR = Path(__file__).parent.parent / "riot" / "templates"  # _tokens.html 재사용

_env = Environment(
    loader=FileSystemLoader([str(_TEMPLATES_DIR), str(_RIOT_TEMPLATES_DIR)]),
    autoescape=select_autoescape(["html"]),
)

_DIVISION_COLORS = {
    "Bronze": "#a0522d", "Silver": "#9eb4c0", "Gold": "#cd8400",
    "Platinum": "#4fc4cf", "Diamond": "#576bce", "Master": "#9d48e0",
    "Grandmaster": "#f4c874", "Champion": "#e84040",
}

_env.filters["division_color"] = lambda d: _DIVISION_COLORS.get(d.capitalize(), "#5865f2")
_env.filters["intfmt"] = lambda v: f"{int(v):,}"


async def _render(template_name: str, ctx: dict, width: int = 800) -> io.BytesIO:
    html = _env.get_template(template_name).render(**ctx)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            page = await browser.new_page(
                viewport={"width": width, "height": 1200},
                device_scale_factor=3,
            )
            await page.set_content(html, wait_until="networkidle")
            png = await page.locator("#card").screenshot()
        finally:
            await browser.close()
    return io.BytesIO(png)


async def render_profile_card(profile) -> io.BytesIO:
    return await _render("profile.html", {"p": profile})


async def render_analysis_card(profile, ai_comment: str | None = None) -> io.BytesIO:
    return await _render("analysis.html", {"p": profile, "ai_comment": ai_comment}, width=1600)


async def render_hero_analysis_card(hero_analysis, ai_comment: str | None = None) -> io.BytesIO:
    return await _render("hero_analysis.html", {"p": hero_analysis, "ai_comment": ai_comment}, width=1400)


_STAT_LABELS = {
    "time_played": "플레이 시간", "games_played": "게임 수", "games_won": "승리", "games_lost": "패배",
    "hero_pick_rate": "전체 대비 픽률", "hero_role_pick_rate": "역할 내 픽률",
    "eliminations": "처치", "assists": "어시스트", "deaths": "데스", "final_blows": "마무리",
    "eliminations_per_life": "처치/데스", "winrate": "승률",
    "solo_kills": "솔로킬", "multikills": "멀티킬", "critical_hits": "크리티컬 히트",
    "critical_hit_kills": "크리티컬 킬", "all_damage_done": "총 피해량", "hero_damage_done": "영웅 피해량",
    "barrier_damage_done": "보호막 피해량", "objective_kills": "오브젝트 처치",
    "melee_final_blows": "근접 마무리", "environmental_kills": "환경 처치",
    "kill_streak_best": "최고 연속처치", "multikill_best": "최고 멀티킬",
    "obj_contest_time": "오브젝트 경합 시간", "self_healing": "자힐량",
    "healing_done": "치유량", "healing_amplified": "증폭된 치유량", "damage_amplified": "증폭된 피해량",
    "offensive_assists": "공격 어시스트", "defensive_assists": "방어 어시스트", "recon_assists": "정찰 어시스트",
    "weapon_accuracy": "무기 명중률", "critical_hit_accuracy": "크리티컬 명중률",
    # 영웅별 고유 지표(hero_specific) — OverFast에서 실제로 확인된 필드 기준 번역.
    # 신규/미확인 영웅 필드는 사전에 없으면 영어 그대로 title-case로 표시된다(_stat_label 폴백).
    "primary_fire_accuracy": "주 사격 명중률", "secondary_fire_accuracy": "보조 사격 명중률",
    "direct_hit_accuracy": "직격 명중률", "long_range_final_blows": "장거리 마무리",
    "overhealth_created": "생성한 과체력", "overhealth_provided": "제공한 과체력",
    "ultimate_negated": "무력화한 궁극기", "ultimates_negated": "무력화한 궁극기",
    # Ana
    "enemies_slept": "수면총 적중", "biotic_grenade_kills": "생체 수류탄 처치",
    "nano_boost_assists": "나노 강화 어시스트", "sleep_dart_accuracy": "수면총 명중률",
    "unscoped_accuracy": "비조준 명중률", "scoped_accuracy": "조준 명중률",
    # Reinhardt
    "charge_kills": "돌진 처치", "fire_strike_kills": "화염 강타 처치", "earthshatter_kills": "대지분쇄 처치",
    "earthshatter_stuns": "대지분쇄 기절", "earthshatter_direct_hits": "대지분쇄 직격",
    "fire_strike_accuracy": "화염 강타 명중률",
    # Cassidy
    "deadeye_kills": "데드아이 처치", "fan_the_hammer_kills": "연속 사격 처치",
    "flashbang_kills": "섬광탄 처치",
    # Genji
    "dragonblade_kills": "용검 처치", "damage_deflected": "반사 피해량", "damage_reflected": "반사 피해량",
    # Tracer
    "pulse_bomb_kills": "펄스 폭탄 처치", "pulse_bombs_attached": "펄스 폭탄 부착",
    "low_health_recalls": "저체력 리콜", "pulse_bomb_attach_rate": "펄스 폭탄 부착률",
    # Widowmaker / Ashe
    "venom_mine_kills": "베놈마인 처치", "scoped_critical_hits": "조준 크리티컬 히트",
    "scoped_critical_hit_kills": "조준 크리티컬 킬", "scoped_critical_hit_accuracy": "조준 크리티컬 명중률",
    "dynamite_kills": "다이너마이트 처치", "coach_gun_kills": "쌍발총 처치", "bob_kills": "밥 처치",
    # Mercy
    "blaster_kills": "블래스터 처치", "players_resurrected": "부활시킨 아군",
    "valkyrie_healing_done": "발키리 치유량", "healing_beam_usage": "치유광선 사용률",
    "offensive_beam_usage": "피해증폭광선 사용률",
    # Lucio
    "sound_barriers_provided": "음파 보호막 제공", "players_knocked_back": "넉백시킨 적",
    "healing_boost_usage": "치유촉진 사용률", "speed_boost_usage": "속도촉진 사용률",
    # Zenyatta
    "transcendence_healing": "초월 치유량", "charged_volley_kills": "충전 연사 처치",
    "charged_volley_accuracy": "충전 연사 명중률", "transcendence_efficiency": "초월 효율",
    # Moira
    "coalescence_kills": "결합 처치", "coalescence_healing": "결합 치유량",
    "biotic_orb_kills": "생체 구슬 처치", "ally_coalescence_efficiency": "아군 결합 효율",
    "enemy_coalescence_efficiency": "적 결합 효율",
    # Winston
    "jump_pack_kills": "점프팩 처치", "primal_rage_kills": "야성 분노 처치",
    "melee_kills": "근접 처치", "jump_kills": "점프 처치", "weapon_kills": "무기 처치",
    # Orisa
    "terra_surge_kills": "대지 쇄도 처치", "energy_javelin_kills": "에너지 창 처치",
    "javelin_spin_kills": "창 회전 처치", "energy_javelin_accuracy": "에너지 창 명중률",
    # Sigma
    "accretion_kills": "응집 처치", "gravitic_flux_kills": "중력 붕괴 처치", "accretion_accuracy": "응집 명중률",
    # Kiriko
    "kitsune_rush_assists": "여우령 질주 어시스트", "kunai_kills": "쿠나이 처치",
    "negative_effects_cleansed": "정화한 방해 효과",
    # Sombra
    "enemies_hacked": "해킹한 적", "low_health_teleports": "저체력 순간이동",
    # Mei
    "enemies_frozen": "빙결시킨 적", "blizzard_kills": "눈보라 처치", "icicle_accuracy": "고드름 명중률",
    # Torbjorn
    "turret_kills": "포탑 처치", "molten_core_kills": "용암 코어 처치", "overload_kills": "과부하 처치",
    # Symmetra
    "sentry_turret_kills": "감시 포탑 처치", "players_teleported": "순간이동시킨 아군",
    "secondary_direct_hits": "보조 직격", "average_damage_multiplier": "평균 피해 배율",
    # Bastion
    "recon_kills": "정찰 모드 처치", "assault_kills": "돌격 모드 처치", "tank_kills": "탱크 모드 처치",
    "tactical_grenade_kills": "전술 수류탄 처치",
    # Junkrat
    "enemies_trapped": "덫에 걸린 적", "rip_tire_kills": "찢어발기기 처치",
    "concussion_mine_kills": "충격 지뢰 처치",
    # Hanzo
    "dragonstrike_kills": "용의 화살 처치", "storm_arrow_kills": "폭풍 화살 처치",
    # Pharah
    "rocket_direct_hits": "로켓 직격", "barrage_kills": "포화 처치", "airtime_percentage": "공중 체공 비율",
    # Soldier: 76
    "helix_rocket_kills": "나선 로켓 처치", "tactical_visor_kills": "전술 조준경 처치",
    "helix_rocket_accuracy": "나선 로켓 명중률",
    # D.Va
    "self_destruct_kills": "자폭 처치", "micro_missile_kills": "소형 미사일 처치",
    "call_mech_kills": "메카 소환 처치",
    # Zarya
    "graviton_surge_kills": "중력자탄 처치", "high_energy_kills": "고에너지 처치",
    "average_energy": "평균 에너지",
    # Roadhog
    "whole_hog_kills": "완전분해 처치", "chain_hook_accuracy": "갈고리 명중률", "chain_hook_kills": "갈고리 처치",
    # Doomfist
    "meteor_strike_kills": "운석 낙하 처치",
    # Wrecking Ball
    "adaptive_shielding_created": "생성한 적응형 보호막", "piledriver_kills": "파일드라이버 처치",
    "grappling_claw_kills": "갈고리발톱 처치", "minefield_kills": "지뢰밭 처치",
    # Echo
    "focusing_beam_kills": "집속 광선 처치", "sticky_bombs_kills": "고착 폭탄 처치",
    "sticky_bombs_direct_hits": "고착 폭탄 직격", "focusing_beam_accuracy": "집속 광선 명중률",
    "sticky_bombs_direct_hit_accuracy": "고착 폭탄 직격률",
    # Brigitte
    "whipshots_attempted": "채찍질 시도", "inspire_uptime_percentage": "고무 지속 비율",
    "whipshot_accuracy": "채찍질 명중률",
}
_STAT_SUFFIXES = ("_avg_per_10_min", "_most_in_game", "_most_in_life", "_best_in_game")


def _stat_base(key: str) -> str:
    for suf in _STAT_SUFFIXES:
        if key.endswith(suf):
            return key[: -len(suf)]
    return key


def _stat_label(key: str) -> str:
    base = _stat_base(key)
    return _STAT_LABELS.get(base) or base.replace("_", " ").title()


def _fmt_total(key: str, v) -> str:
    if key == "time_played":
        return f"{round(v / 3600, 1)}시간"
    return f"{v:,.1f}" if isinstance(v, float) and v % 1 else f"{int(v):,}"


def _fmt_best(key: str, v) -> str:
    if "accuracy" in _stat_base(key):
        return f"{v:.0f}%"
    return f"{v:,.1f}" if isinstance(v, float) and v % 1 else f"{int(v):,}"


def _fmt_percentage(key: str, v) -> str:
    # eliminations_per_life는 "비율"이지 확률이 아니라 %를 붙이면 안 된다 (예: 2.41).
    if _stat_base(key) == "eliminations_per_life":
        return f"{v:.2f}"
    return f"{v:.2f}%"


def _fmt_stat_block(block) -> dict:
    """HeroDetail의 StatBlock(동적 OverFast key/value)을 카드에 바로 뿌릴 수 있는
    [(라벨, 표시값)] 리스트들로 변환 — 포맷 규칙(단위·소수점)을 템플릿이 아니라 여기서 결정한다."""
    return {
        "total": [(_stat_label(k), _fmt_total(k, v)) for k, v in block.total.items()],
        "per10min": [(_stat_label(k), f"{v:.2f}") for k, v in block.per10min.items()],
        "percentage": [(_stat_label(k), _fmt_percentage(k, v)) for k, v in block.percentage.items()],
        "best": [(_stat_label(k), _fmt_best(k, v)) for k, v in block.best.items()],
        "best_life": [(_stat_label(k), _fmt_best(k, v)) for k, v in block.best_life.items()],
    }


async def render_hero_detail_card(hero_detail, ai_comment: str | None = None) -> io.BytesIO:
    """!오버워치 영웅분석 드롭다운의 영웅별 상세분석 카드 (한 장으로 통합)."""
    ctx = {
        "hd": hero_detail,
        "hero_role_pick_rate": f"{hero_detail.experience.percentage.get('hero_role_pick_rate', 0):.2f}%",
        "experience": _fmt_stat_block(hero_detail.experience),
        "performance": _fmt_stat_block(hero_detail.performance),
        "attack": _fmt_stat_block(hero_detail.attack),
        "survival": _fmt_stat_block(hero_detail.survival),
        "support": _fmt_stat_block(hero_detail.support) if hero_detail.support else None,
        "aim": _fmt_stat_block(hero_detail.aim) if hero_detail.aim else None,
        "hero_specific": _fmt_stat_block(hero_detail.hero_specific),
        "ai_comment": ai_comment,
    }
    return await _render("hero_detail.html", ctx, width=2000)
