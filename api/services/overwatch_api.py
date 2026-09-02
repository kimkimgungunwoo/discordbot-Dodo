"""OverFast API(overfast-api.tekrop.fr) 클라이언트 — 블리자드 공식 API가 없어 이 오픈소스
공개 API(블리자드 공식 전적 페이지를 스크래핑해 REST로 제공)를 씀. 인증 불필요.
"""
import asyncio
import aiohttp
from dataclasses import dataclass

OVERFAST_BASE = "https://overfast-api.tekrop.fr"

ROLE_KR = {"tank": "탱커", "damage": "딜러", "support": "힐러"}
_ROLE_ORDER = ["tank", "damage", "support"]

TIER_KR = {
    "Bronze": "브론즈", "Silver": "실버", "Gold": "골드", "Platinum": "플래티넘",
    "Diamond": "다이아몬드", "Master": "마스터", "Grandmaster": "그랜드마스터", "Champion": "챔피언",
}

_hero_cache: dict[str, dict] = {}  # key -> {"name":..., "portrait":...}


class OverwatchAPIError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


async def _get(session: aiohttp.ClientSession, path: str, params: dict | None = None):
    async with session.get(f"{OVERFAST_BASE}{path}", params=params) as resp:
        if resp.status != 200:
            try:
                data = await resp.json()
            except Exception:
                data = {}
            raise OverwatchAPIError(resp.status, data.get("error") or f"OverFast 오류 (status={resp.status})")
        return await resp.json()


async def _ensure_hero_cache(session: aiohttp.ClientSession) -> dict[str, dict]:
    if _hero_cache:
        return _hero_cache
    heroes = await _get(session, "/heroes", params={"locale": "ko-kr"})
    for h in heroes:
        _hero_cache[h["key"]] = {"name": h["name"], "portrait": h["portrait"], "role": h["role"]}
    return _hero_cache


@dataclass
class PlayerSearchResult:
    player_id: str
    name: str
    title: str | None
    avatar: str


async def search_players(name: str) -> list[PlayerSearchResult]:
    async with aiohttp.ClientSession() as session:
        data = await _get(session, "/players", params={"name": name})
    return [
        PlayerSearchResult(
            player_id=p["player_id"], name=p["name"], title=p.get("title"), avatar=p["avatar"],
        )
        for p in data.get("results", [])
    ]


@dataclass
class RoleRank:
    role: str
    division: str
    tier: int
    rank_icon: str

    @property
    def role_kr(self) -> str:
        return ROLE_KR.get(self.role, self.role)

    @property
    def division_kr(self) -> str:
        # OverFast가 division 값을 "Master"/"master"처럼 대소문자 섞어서 줄 때가 있어 정규화 후 조회.
        return TIER_KR.get(self.division.capitalize(), self.division)


@dataclass
class RoleStat:
    role: str
    games_played: int
    time_played: int
    winrate: float
    kda: float
    deaths_per_10min: float
    damage_per_10min: float
    healing_per_10min: float

    @property
    def role_kr(self) -> str:
        return ROLE_KR.get(self.role, self.role)

    @property
    def hours_played(self) -> float:
        return round(self.time_played / 3600, 1)


@dataclass
class HeroStat:
    key: str
    name: str
    portrait: str
    games_played: int
    winrate: float
    kda: float
    time_played: int
    role: str = ""

    @property
    def hours_played(self) -> float:
        return round(self.time_played / 3600, 1)


def _extract_top_heroes(stats: dict, heroes_meta: dict, limit: int) -> list[HeroStat]:
    heroes: dict = stats.get("heroes") or {}
    top = sorted(heroes.items(), key=lambda kv: kv[1].get("time_played", 0), reverse=True)[:limit]
    return [
        HeroStat(
            key=key,
            name=heroes_meta.get(key, {}).get("name", key.title()),
            portrait=heroes_meta.get(key, {}).get("portrait", ""),
            games_played=v.get("games_played", 0),
            winrate=v.get("winrate", 0.0),
            kda=v.get("kda", 0.0),
            time_played=v.get("time_played", 0),
            role=heroes_meta.get(key, {}).get("role", ""),
        )
        for key, v in top
    ]


def _extract_all_heroes(stats: dict, heroes_meta: dict) -> list[HeroStat]:
    """!오버워치 영웅분석 '단일 영웅' 드롭다운 전용 — 플레이 여부와 상관없이 전체 로스터를
    플레이시간 순으로 반환한다(안 한 영웅은 0시간으로 자연히 맨 뒤에 깔린다)."""
    played: dict = stats.get("heroes") or {}
    all_heroes = [
        HeroStat(
            key=key,
            name=meta.get("name", key.title()),
            portrait=meta.get("portrait", ""),
            games_played=(played.get(key) or {}).get("games_played", 0),
            winrate=(played.get(key) or {}).get("winrate", 0.0),
            kda=(played.get(key) or {}).get("kda", 0.0),
            time_played=(played.get(key) or {}).get("time_played", 0),
            role=meta.get("role", ""),
        )
        for key, meta in heroes_meta.items()
    ]
    all_heroes.sort(key=lambda h: h.time_played, reverse=True)
    return all_heroes


@dataclass
class CombatTotals:
    """빠른대전+경쟁전 합산 전투 누적 기록 (stats/career의 combat 카테고리)."""
    eliminations: int
    deaths: int
    final_blows: int
    solo_kills: int
    multikills: int
    objective_kills: int
    melee_final_blows: int
    environmental_kills: int


@dataclass
class AssistTotals:
    """빠른대전+경쟁전 합산 지원 누적 기록 (stats/career의 assists 카테고리)."""
    total_assists: int
    defensive_assists: int
    offensive_assists: int
    recon_assists: int


@dataclass
class BestRecords:
    """한 게임 내 개인 최고 기록 (빠른대전/경쟁전 통틀어 최댓값, stats/career의 best 카테고리)."""
    eliminations_most: int
    final_blows_most: int
    damage_most: int
    healing_most: int
    kill_streak_best: int
    multikill_best: int
    solo_kills_most: int


_EMPTY_CAREER_STATS: dict = {}


async def _fetch_career_stats(session: aiohttp.ClientSession, player_id: str, gamemode: str) -> dict:
    """stats/career는 gamemode가 필수라 빠른대전/경쟁전을 따로 불러 합쳐야 한다. 한 번 호출하면
    combat/best/assists 등 카테고리가 전부 같이 오므로, 카테고리별로 따로 부르지 않고 여기서
    한 번만 불러 필요한 카테고리를 전부 뽑아 쓴다(안 그러면 게임모드당 3번씩 총 6번을 불러야 해서
    OverFast 레이트리밋에 걸리기 쉽고, 그중 하나만 실패해도 합계가 조용히 틀어짐).
    한쪽 모드 기록이 없는 계정(경쟁전만 하거나 빠른대전만 한 경우)도 있어서, 실패하면 빈 값으로
    취급하고 넘어간다."""
    try:
        data = await _get(
            session, f"/players/{player_id}/stats/career",
            params={"gamemode": gamemode, "hero": "all-heroes"},
        )
        return data.get("all-heroes") or {}
    except OverwatchAPIError:
        return _EMPTY_CAREER_STATS


@dataclass
class OverwatchProfile:
    player_id: str
    name: str
    title: str | None
    avatar: str
    namecard: str
    endorsement_level: int
    endorsement_icon: str
    ranks: list[RoleRank]
    games_played: int
    games_won: int
    winrate: float
    # OverFast의 "average" 필드는 게임당 평균이 아니라 "10분당" 정규화 값이다
    # (total.deaths ÷ (time_played/600) 이 average.deaths와 정확히 일치함을 실측 확인) — 그래서
    # 이름을 avg_*가 아니라 *_per_10min으로 붙인다. 블리자드 공식 전적 페이지도 이 기준을 씀.
    elims_per_10min: float
    assists_per_10min: float
    deaths_per_10min: float
    damage_per_10min: float
    healing_per_10min: float
    role_stats: list[RoleStat]
    top_heroes: list[HeroStat]
    combat: CombatTotals
    best: BestRecords
    assist_totals: AssistTotals
    time_played: int          # 전체 플레이 시간(초) — 역할별 시간 비중 계산 기준
    final_blows_per_10min: float

    @property
    def hours_played(self) -> float:
        return round(self.time_played / 3600, 1)

    @property
    def elim_per_life(self) -> float:
        """처치 ÷ 데스 — KDA(어시 포함)와 별개로 순수 "죽기 전 몇 명 잡았나" 지표."""
        return round(self.combat.eliminations / max(self.combat.deaths, 1), 2)

    @property
    def kda(self) -> float:
        return round((self.elims_per_10min + self.assists_per_10min) / max(self.deaths_per_10min, 0.01), 2)


async def fetch_profile(player_id: str) -> OverwatchProfile:
    async with aiohttp.ClientSession() as session:
        summary, stats, heroes_meta, career_qp, career_comp = await asyncio.gather(
            _get(session, f"/players/{player_id}/summary"),
            _get(session, f"/players/{player_id}/stats/summary"),
            _ensure_hero_cache(session),
            _fetch_career_stats(session, player_id, "quickplay"),
            _fetch_career_stats(session, player_id, "competitive"),
        )

    combat_qp, combat_comp = career_qp.get("combat", {}), career_comp.get("combat", {})
    best_qp, best_comp = career_qp.get("best", {}), career_comp.get("best", {})
    assists_qp, assists_comp = career_qp.get("assists", {}), career_comp.get("assists", {})

    def _sum(d1: dict, d2: dict, key: str) -> int:
        return d1.get(key, 0) + d2.get(key, 0)

    combat = CombatTotals(
        eliminations=_sum(combat_qp, combat_comp, "eliminations"),
        deaths=_sum(combat_qp, combat_comp, "deaths"),
        final_blows=_sum(combat_qp, combat_comp, "final_blows"),
        solo_kills=_sum(combat_qp, combat_comp, "solo_kills"),
        multikills=_sum(combat_qp, combat_comp, "multikills"),
        objective_kills=_sum(combat_qp, combat_comp, "objective_kills"),
        melee_final_blows=_sum(combat_qp, combat_comp, "melee_final_blows"),
        environmental_kills=_sum(combat_qp, combat_comp, "environmental_kills"),
    )

    assist_totals = AssistTotals(
        total_assists=_sum(assists_qp, assists_comp, "assists"),
        defensive_assists=_sum(assists_qp, assists_comp, "defensive_assists"),
        offensive_assists=_sum(assists_qp, assists_comp, "offensive_assists"),
        recon_assists=_sum(assists_qp, assists_comp, "recon_assists"),
    )

    def _max(key: str) -> int:
        return max(best_qp.get(key, 0), best_comp.get(key, 0))

    best = BestRecords(
        eliminations_most=_max("eliminations_most_in_game"),
        final_blows_most=_max("final_blows_most_in_game"),
        damage_most=_max("hero_damage_done_most_in_game"),
        healing_most=_max("healing_done_most_in_game"),
        kill_streak_best=_max("kill_streak_best"),
        multikill_best=_max("multikill_best"),
        solo_kills_most=_max("solo_kills_most_in_game"),
    )

    ranks = []
    comp = (summary.get("competitive") or {}).get("pc") or {}
    for role in _ROLE_ORDER:
        r = comp.get(role)
        if r:
            ranks.append(RoleRank(role=role, division=r["division"], tier=r["tier"], rank_icon=r["rank_icon"]))

    general = stats.get("general") or {}
    avg = general.get("average") or {}

    roles_raw: dict = stats.get("roles") or {}
    role_stats = [
        RoleStat(
            role=role,
            games_played=v.get("games_played", 0),
            time_played=v.get("time_played", 0),
            winrate=v.get("winrate", 0.0),
            kda=v.get("kda", 0.0),
            deaths_per_10min=(v.get("average") or {}).get("deaths", 0.0),
            damage_per_10min=(v.get("average") or {}).get("damage", 0.0),
            healing_per_10min=(v.get("average") or {}).get("healing", 0.0),
        )
        for role in _ROLE_ORDER
        if (v := roles_raw.get(role))
    ]

    top_heroes = _extract_top_heroes(stats, heroes_meta, 3)

    endorsement = summary.get("endorsement") or {}
    total_time_played = general.get("time_played", 0)
    final_blows_per_10min = round(combat.final_blows / max(total_time_played / 600, 0.01), 2)

    return OverwatchProfile(
        player_id=player_id,
        name=summary.get("username", ""),
        title=summary.get("title"),
        avatar=summary.get("avatar", ""),
        namecard=summary.get("namecard", ""),
        endorsement_level=endorsement.get("level", 0),
        endorsement_icon=endorsement.get("frame", ""),
        ranks=ranks,
        games_played=general.get("games_played", 0),
        games_won=general.get("games_won", 0),
        winrate=general.get("winrate", 0.0),
        elims_per_10min=avg.get("eliminations", 0.0),
        assists_per_10min=avg.get("assists", 0.0),
        deaths_per_10min=avg.get("deaths", 0.0),
        damage_per_10min=avg.get("damage", 0.0),
        healing_per_10min=avg.get("healing", 0.0),
        role_stats=role_stats,
        top_heroes=top_heroes,
        combat=combat,
        best=best,
        assist_totals=assist_totals,
        time_played=total_time_played,
        final_blows_per_10min=final_blows_per_10min,
    )


@dataclass
class HeroAnalysis:
    """!오버워치 영웅분석 전용 — 가벼운 지표(stats/summary 하나만 호출)로 상위 영웅 목록만 본다.
    career/combat/best 등 무거운 데이터는 여기서 안 씀 (필요해지면 영웅별 상세분석 단계에서 추가)."""
    player_id: str
    name: str
    title: str | None
    avatar: str
    top_heroes: list[HeroStat]


async def fetch_hero_analysis(player_id: str, limit: int = 10) -> HeroAnalysis:
    async with aiohttp.ClientSession() as session:
        summary, stats, heroes_meta = await asyncio.gather(
            _get(session, f"/players/{player_id}/summary"),
            _get(session, f"/players/{player_id}/stats/summary"),
            _ensure_hero_cache(session),
        )
    return HeroAnalysis(
        player_id=player_id,
        name=summary.get("username", ""),
        title=summary.get("title"),
        avatar=summary.get("avatar", ""),
        top_heroes=_extract_top_heroes(stats, heroes_meta, limit),
    )


async def fetch_all_heroes(player_id: str) -> HeroAnalysis:
    """'단일 영웅' 드롭다운 전용 — 전체 로스터(53명)를 플레이시간 순으로 담아 반환한다."""
    async with aiohttp.ClientSession() as session:
        summary, stats, heroes_meta = await asyncio.gather(
            _get(session, f"/players/{player_id}/summary"),
            _get(session, f"/players/{player_id}/stats/summary"),
            _ensure_hero_cache(session),
        )
    return HeroAnalysis(
        player_id=player_id,
        name=summary.get("username", ""),
        title=summary.get("title"),
        avatar=summary.get("avatar", ""),
        top_heroes=_extract_all_heroes(stats, heroes_meta),
    )


# ── !오버워치 영웅분석 드롭다운의 영웅별 상세분석 ──────────────────────────────
#
# OverFast의 stats/career는 gamemode(quickplay/competitive)별로만 조회되고, 영웅별 카테고리
# (combat/assists/average/best/hero_specific)마다 필드가 제각각이라 두 모드를 하나로 합칠 때
# 공식 필드 목록을 고정해두면 신규/희귀 필드를 계속 놓친다. 그래서 키 접미사 규칙
# (_avg_per_10_min → 10분당, _most_in_game·_most_in_life·_best_in_game → 최고기록,
# accuracy/rate/win_percentage/eliminations_per_life → 비율)으로 종류를 동적으로 판별해
# 두 모드를 합치고, 그 결과에서 필요한 항목만 base 이름으로 골라 UI 섹션을 구성한다.

_BEST_SUFFIXES = ("_most_in_game", "_most_in_life", "_best_in_game")
_PERCENT_KEYS = {"eliminations_per_life", "win_percentage"}


def _classify_stat_key(key: str) -> str:
    if key.endswith("_most_in_life"):
        return "best_life"
    if key.endswith(_BEST_SUFFIXES):
        return "best"
    if key.endswith("_avg_per_10_min"):
        return "per10min"
    if key in _PERCENT_KEYS or "accuracy" in key or key.endswith("_rate"):
        return "percentage"
    return "total"


def _base_of(key: str) -> str:
    for suf in _BEST_SUFFIXES + ("_avg_per_10_min",):
        if key.endswith(suf):
            return key[: -len(suf)]
    return key


@dataclass
class StatBlock:
    """OverFast 원본 key를 그대로 보존하는 동적 통계 묶음 — 실제 존재하는 값만 채워진다.
    best(한 게임 최고)와 best_life(한 목숨 최고)를 분리하는 이유: 예를 들어 eliminations는
    most_in_game과 most_in_life가 둘 다 존재해서 하나로 합치면 같은 라벨("처치")로 서로 다른
    값이 중복 표시된다."""
    total: dict = None
    per10min: dict = None
    percentage: dict = None
    best: dict = None
    best_life: dict = None

    def __post_init__(self):
        self.total = self.total or {}
        self.per10min = self.per10min or {}
        self.percentage = self.percentage or {}
        self.best = self.best or {}
        self.best_life = self.best_life or {}

    @property
    def is_empty(self) -> bool:
        return not (self.total or self.per10min or self.percentage or self.best or self.best_life)


def _merge_stat_category(qp: dict, comp: dict, qp_weight: float, comp_weight: float) -> StatBlock:
    """빠른대전+경쟁전 원본 딕셔너리 하나를 합친다. total은 합산, best(한 게임 최고 기록)는
    최댓값을 취한다. per10min은 qp_weight/comp_weight(보통 그 영웅의 모드별 플레이시간)로
    가중평균하면 총합÷총시간과 수학적으로 정확히 같아진다. percentage/비율류는 정확한 분모
    (명중 시도 수 등)를 OverFast가 안 줘서 같은 가중평균으로 근사한다."""
    total_weight = (qp_weight + comp_weight) or 1
    out = StatBlock()
    for key in set(qp) | set(comp):
        qv, cv = qp.get(key, 0), comp.get(key, 0)
        kind = _classify_stat_key(key)
        if kind == "total":
            out.total[key] = qv + cv
        elif kind == "best":
            out.best[key] = max(qv, cv)
        elif kind == "best_life":
            out.best_life[key] = max(qv, cv)
        elif kind == "per10min":
            out.per10min[key] = round((qv * qp_weight + cv * comp_weight) / total_weight, 2)
        else:
            out.percentage[key] = round((qv * qp_weight + cv * comp_weight) / total_weight, 2)
    return out


def _union_blocks(*blocks: StatBlock) -> StatBlock:
    out = StatBlock()
    for b in blocks:
        out.total.update(b.total)
        out.per10min.update(b.per10min)
        out.percentage.update(b.percentage)
        out.best.update(b.best)
        out.best_life.update(b.best_life)
    return out


def _pick_bases(block: StatBlock, bases: set[str]) -> StatBlock:
    return StatBlock(
        total={k: v for k, v in block.total.items() if _base_of(k) in bases},
        per10min={k: v for k, v in block.per10min.items() if _base_of(k) in bases},
        percentage={k: v for k, v in block.percentage.items() if _base_of(k) in bases},
        best={k: v for k, v in block.best.items() if _base_of(k) in bases},
        best_life={k: v for k, v in block.best_life.items() if _base_of(k) in bases},
    )


def _all_bases(block: StatBlock) -> set[str]:
    return {
        _base_of(k)
        for sub in (block.total, block.per10min, block.percentage, block.best, block.best_life)
        for k in sub
    }


_PERFORMANCE_BASES = {"eliminations", "assists", "deaths", "final_blows", "eliminations_per_life"}
_ATTACK_BASES = {
    "eliminations", "final_blows", "solo_kills", "multikills", "critical_hits",
    "critical_hit_kills", "all_damage_done", "hero_damage_done", "barrier_damage_done",
    "objective_kills", "melee_final_blows", "environmental_kills", "kill_streak_best", "multikill_best",
}
_SURVIVAL_BASES = {"deaths", "obj_contest_time", "self_healing", "eliminations_per_life"}
_SUPPORT_BASES = {
    "healing_done", "self_healing", "healing_amplified", "damage_amplified",
    "assists", "offensive_assists", "defensive_assists", "recon_assists",
}


@dataclass
class HeroDetail:
    player_id: str
    player_name: str
    player_avatar: str
    hero_key: str
    hero_name: str
    hero_portrait: str
    hero_role: str
    games_played: int
    games_won: int
    games_lost: int
    time_played: int
    winrate: float
    kda: float
    experience: StatBlock
    performance: StatBlock
    attack: StatBlock
    survival: StatBlock
    support: StatBlock | None
    aim: StatBlock | None
    hero_specific: StatBlock

    @property
    def hours_played(self) -> float:
        return round(self.time_played / 3600, 1)

    @property
    def role_kr(self) -> str:
        return ROLE_KR.get(self.hero_role, self.hero_role)


async def fetch_hero_detail(player_id: str, hero_key: str) -> HeroDetail:
    async with aiohttp.ClientSession() as session:
        summary, stats, heroes_meta, career_qp, career_comp = await asyncio.gather(
            _get(session, f"/players/{player_id}/summary"),
            _get(session, f"/players/{player_id}/stats/summary"),
            _ensure_hero_cache(session),
            _get(
                session, f"/players/{player_id}/stats/career",
                params={"gamemode": "quickplay", "hero": hero_key},
            ),
            _get(
                session, f"/players/{player_id}/stats/career",
                params={"gamemode": "competitive", "hero": hero_key},
            ),
        )

    qp = career_qp.get(hero_key) or {}
    comp = career_comp.get(hero_key) or {}
    qp_time = (qp.get("game") or {}).get("time_played", 0)
    comp_time = (comp.get("game") or {}).get("time_played", 0)

    combat_m = _merge_stat_category(qp.get("combat", {}), comp.get("combat", {}), qp_time, comp_time)
    assists_m = _merge_stat_category(qp.get("assists", {}), comp.get("assists", {}), qp_time, comp_time)
    average_m = _merge_stat_category(qp.get("average", {}), comp.get("average", {}), qp_time, comp_time)
    best_m = _merge_stat_category(qp.get("best", {}), comp.get("best", {}), qp_time, comp_time)
    hero_specific_m = _merge_stat_category(
        qp.get("hero_specific", {}), comp.get("hero_specific", {}), qp_time, comp_time,
    )

    # eliminations_per_life는 정확한 분자/분모(누적 처치·데스)를 이미 combat_m에서 알 수 있으니
    # 가중평균 근사 대신 정확히 다시 계산해 덮어쓴다.
    if "eliminations" in combat_m.total and "deaths" in combat_m.total:
        average_m.percentage["eliminations_per_life"] = round(
            combat_m.total["eliminations"] / max(combat_m.total["deaths"], 1), 2,
        )

    all_m = _union_blocks(combat_m, assists_m, average_m, best_m, hero_specific_m)

    hero_meta = heroes_meta.get(hero_key, {})
    role = hero_meta.get("role", "damage")

    hero_summary = (stats.get("heroes") or {}).get(hero_key) or {}
    general = stats.get("general") or {}
    role_summary = (stats.get("roles") or {}).get(role) or {}
    hero_time = hero_summary.get("time_played", 0)
    total_time = general.get("time_played", 0) or 1
    role_time = role_summary.get("time_played", 0) or 1

    experience = StatBlock(
        total={
            "time_played": hero_time,
            "games_played": hero_summary.get("games_played", 0),
            "games_won": hero_summary.get("games_won", 0),
            "games_lost": hero_summary.get("games_lost", 0),
        },
        percentage={
            "hero_pick_rate": round(hero_time / total_time * 100, 2),
            "hero_role_pick_rate": round(hero_time / role_time * 100, 2),
        },
    )

    performance = _pick_bases(all_m, _PERFORMANCE_BASES)
    performance.percentage["winrate"] = hero_summary.get("winrate", 0.0)

    attack = _pick_bases(all_m, _ATTACK_BASES)

    survival = _pick_bases(all_m, _SURVIVAL_BASES)

    support = _pick_bases(all_m, _SUPPORT_BASES) if role == "support" else None
    if support is not None and support.is_empty:
        support = None

    aim_bases = {b for b in _all_bases(all_m) if "accuracy" in b} | {"critical_hits", "critical_hit_kills"}
    aim = _pick_bases(all_m, aim_bases)
    if aim.is_empty:
        aim = None

    return HeroDetail(
        player_id=player_id,
        player_name=summary.get("username", ""),
        player_avatar=summary.get("avatar", ""),
        hero_key=hero_key,
        hero_name=hero_meta.get("name", hero_key.title()),
        hero_portrait=hero_meta.get("portrait", ""),
        hero_role=role,
        games_played=hero_summary.get("games_played", 0),
        games_won=hero_summary.get("games_won", 0),
        games_lost=hero_summary.get("games_lost", 0),
        time_played=hero_time,
        winrate=hero_summary.get("winrate", 0.0),
        kda=hero_summary.get("kda", 0.0),
        experience=experience,
        performance=performance,
        attack=attack,
        survival=survival,
        support=support,
        aim=aim,
        hero_specific=hero_specific_m,
    )
