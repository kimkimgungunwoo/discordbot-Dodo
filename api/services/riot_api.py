import os
import asyncio
import aiohttp
from collections import Counter
from dataclasses import dataclass
from dotenv import load_dotenv
from api.services.riot_analysis import grade_player

load_dotenv()


RIOT_API_KEY = os.getenv("RIOT_API_KEY", "")
ASIA_BASE    = "https://asia.api.riotgames.com"
KR_BASE      = "https://kr.api.riotgames.com"
DDRAGON_BASE = "https://ddragon.leagueoflegends.com"

TIER_KR = {
    "IRON": "아이언", "BRONZE": "브론즈", "SILVER": "실버",
    "GOLD": "골드", "PLATINUM": "플래티넘", "EMERALD": "에메랄드",
    "DIAMOND": "다이아몬드", "MASTER": "마스터",
    "GRANDMASTER": "그랜드마스터", "CHALLENGER": "챌린저",
}
RANK_KR = {"I": "1", "II": "2", "III": "3", "IV": "4"}
POSITION_KR = {
    "TOP": "탑", "JUNGLE": "정글", "MIDDLE": "미드",
    "BOTTOM": "원딜", "UTILITY": "서포터",
}

_champ_cache: dict[int, tuple[str, str]] = {}  # id -> (korean_name, english_key)
_ddragon_version: str = ""


class RiotAPIError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


@dataclass
class RankInfo:
    queue_type: str
    tier: str
    rank: str
    lp: int
    wins: int
    losses: int

    @property
    def win_rate(self) -> float:
        total = self.wins + self.losses
        return round(self.wins / total * 100, 1) if total else 0.0

    @property
    def tier_kr(self) -> str:
        kr = TIER_KR.get(self.tier, self.tier)
        if self.tier in ("MASTER", "GRANDMASTER", "CHALLENGER"):
            return kr
        return f"{kr} {RANK_KR.get(self.rank, self.rank)}"


@dataclass
class MasteryInfo:
    champion_name: str
    champion_key: str
    mastery_level: int
    mastery_points: int

    @property
    def splash_url(self) -> str:
        return f"https://ddragon.leagueoflegends.com/cdn/img/champion/splash/{self.champion_key}_0.jpg"

    @property
    def icon_url(self) -> str:
        return f"https://ddragon.leagueoflegends.com/cdn/img/champion/loading/{self.champion_key}_0.jpg"


@dataclass
class QueueStats:
    wins: int
    losses: int
    main_position: str
    avg_kills: float
    avg_deaths: float
    avg_assists: float

    @property
    def win_rate(self) -> float:
        total = self.wins + self.losses
        return round(self.wins / total * 100, 1) if total else 0.0

    @property
    def main_position_kr(self) -> str:
        return POSITION_KR.get(self.main_position, "-")

    @property
    def total_games(self) -> int:
        return self.wins + self.losses


@dataclass
class MatchResult:
    win: bool
    champion_name: str
    champion_key: str
    kills: int
    deaths: int
    assists: int
    cs: int
    duration: int
    position: str
    ddragon_version: str
    kill_participation: int   # 0–100
    damage: int               # totalDamageDealtToChampions
    multikill: int            # 0=없음 2=더블 3=트리플 4=쿼드라 5=펜타
    grade: str                # 포지션 보정 등급 (🔥 캐리 / ✅ 활약 / 😐 평범 / 💀 발목)

    @property
    def kda(self) -> float:
        return round((self.kills + self.assists) / max(self.deaths, 1), 2)

    @property
    def duration_str(self) -> str:
        m, s = divmod(self.duration, 60)
        return f"{m}분 {s}초"

    @property
    def position_kr(self) -> str:
        return POSITION_KR.get(self.position, "-")

    @property
    def champ_icon_url(self) -> str:
        return f"{DDRAGON_BASE}/cdn/{self.ddragon_version}/img/champion/{self.champion_key}.png"

    @property
    def damage_str(self) -> str:
        return f"{self.damage / 1000:.1f}k" if self.damage >= 1000 else str(self.damage)


@dataclass
class SummonerProfile:
    game_name: str
    tag_line: str
    puuid: str
    summoner_level: int
    profile_icon_id: int
    ranks: list[RankInfo]
    top_champions: list[MasteryInfo]
    solo_stats: "QueueStats | None"
    flex_stats: "QueueStats | None"
    ddragon_version: str

    @property
    def profile_icon_url(self) -> str:
        return f"{DDRAGON_BASE}/cdn/{self.ddragon_version}/img/profileicon/{self.profile_icon_id}.png"

    @property
    def solo_rank(self) -> RankInfo | None:
        return next((r for r in self.ranks if r.queue_type == "RANKED_SOLO_5x5"), None)

    @property
    def flex_rank(self) -> RankInfo | None:
        return next((r for r in self.ranks if r.queue_type == "RANKED_FLEX_SR"), None)


async def _riot_get(session: aiohttp.ClientSession, url: str, params: dict | None = None):
    headers = {"X-Riot-Token": RIOT_API_KEY}
    async with session.get(url, headers=headers, params=params) as resp:
        if resp.status == 404:
            raise RiotAPIError(404, "소환사를 찾을 수 없습니다.")
        if resp.status in (401, 403):
            raise RiotAPIError(resp.status, "API 키가 유효하지 않습니다. `.env`의 `RIOT_API_KEY`를 확인해주세요.")
        if resp.status == 429:
            raise RiotAPIError(429, "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.")
        if resp.status != 200:
            raise RiotAPIError(resp.status, f"Riot API 오류 (HTTP {resp.status})")
        return await resp.json()


async def _public_get(session: aiohttp.ClientSession, url: str):
    async with session.get(url) as resp:
        resp.raise_for_status()
        return await resp.json()


async def _ensure_champ_cache(session: aiohttp.ClientSession) -> tuple[dict[int, str], str]:
    global _champ_cache, _ddragon_version
    if _champ_cache:
        return _champ_cache, _ddragon_version

    versions = await _public_get(session, f"{DDRAGON_BASE}/api/versions.json")
    _ddragon_version = versions[0]
    data = await _public_get(
        session, f"{DDRAGON_BASE}/cdn/{_ddragon_version}/data/ko_KR/champion.json"
    )
    for champ_data in data["data"].values():
        _champ_cache[int(champ_data["key"])] = (champ_data["name"], champ_data["id"])

    return _champ_cache, _ddragon_version


async def _safe_match_fetch(
    session: aiohttp.ClientSession, match_id: str, sem: asyncio.Semaphore
) -> dict | None:
    async with sem:
        try:
            return await _riot_get(session, f"{ASIA_BASE}/lol/match/v5/matches/{match_id}")
        except Exception:
            return None


async def fetch_profile(game_name: str, tag_line: str) -> SummonerProfile:
    async with aiohttp.ClientSession() as session:
        # 1. Riot ID → puuid
        account = await _riot_get(
            session,
            f"{ASIA_BASE}/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}",
        )
        puuid = account["puuid"]

        # 2. 병렬: 소환사 + 마스터리 + 큐별 매치ID + 랭크 + 챔피언 캐시
        (summoner, mastery_raw, solo_ids, flex_ids,
         league_raw, (champ_map, ddragon_ver)) = await asyncio.gather(
            _riot_get(session, f"{KR_BASE}/lol/summoner/v4/summoners/by-puuid/{puuid}"),
            _riot_get(session, f"{KR_BASE}/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top", {"count": 3}),
            _riot_get(session, f"{ASIA_BASE}/lol/match/v5/matches/by-puuid/{puuid}/ids", {"queue": 420, "count": 10}),
            _riot_get(session, f"{ASIA_BASE}/lol/match/v5/matches/by-puuid/{puuid}/ids", {"queue": 440, "count": 10}),
            _riot_get(session, f"{KR_BASE}/lol/league/v4/entries/by-puuid/{puuid}"),
            _ensure_champ_cache(session),
        )

        counts = [len(solo_ids), len(flex_ids)]
        all_ids = list(solo_ids) + list(flex_ids)
        sem = asyncio.Semaphore(5)
        all_results = await asyncio.gather(*[_safe_match_fetch(session, mid, sem) for mid in all_ids])

    def _split(results, sizes):
        out, i = [], 0
        for s in sizes:
            out.append([m for m in results[i:i+s] if m is not None])
            i += s
        return out

    solo_matches, flex_matches = _split(all_results, counts)

    # RankInfo 빌드
    ranks = [
        RankInfo(
            queue_type=entry["queueType"],
            tier=entry["tier"],
            rank=entry["rank"],
            lp=entry["leaguePoints"],
            wins=entry["wins"],
            losses=entry["losses"],
        )
        for entry in league_raw
        if entry["queueType"] in ("RANKED_SOLO_5x5", "RANKED_FLEX_SR")
    ]

    # MasteryInfo 빌드
    top_champions = [
        MasteryInfo(
            champion_name=champ_map.get(m["championId"], (str(m["championId"]), ""))[0],
            champion_key=champ_map.get(m["championId"], ("", str(m["championId"])))[1],
            mastery_level=m["championLevel"],
            mastery_points=m["championPoints"],
        )
        for m in mastery_raw
    ]

    def _compute_stats(matches: list[dict]) -> QueueStats | None:
        wins = losses = kills = deaths = assists = 0
        positions: list[str] = []
        for match in matches:
            me = next((p for p in match["info"]["participants"] if p["puuid"] == puuid), None)
            if me is None:
                continue
            if me["win"]:
                wins += 1
            else:
                losses += 1
            kills   += me["kills"]
            deaths  += me["deaths"]
            assists += me["assists"]
            pos = me.get("individualPosition", "")
            if pos and pos not in ("Invalid", "NONE", ""):
                positions.append(pos)
        total = wins + losses
        if total == 0:
            return None
        return QueueStats(
            wins=wins, losses=losses,
            main_position=Counter(positions).most_common(1)[0][0] if positions else "NONE",
            avg_kills=round(kills / total, 1),
            avg_deaths=round(deaths / total, 1),
            avg_assists=round(assists / total, 1),
        )

    return SummonerProfile(
        game_name=account["gameName"],
        tag_line=account["tagLine"],
        puuid=puuid,
        summoner_level=summoner["summonerLevel"],
        profile_icon_id=summoner["profileIconId"],
        ranks=ranks,
        top_champions=top_champions,
        solo_stats=_compute_stats(solo_matches),
        flex_stats=_compute_stats(flex_matches),
        ddragon_version=ddragon_ver,
    )


async def fetch_match_history(puuid: str, queue_id: int, count: int = 5) -> list[MatchResult]:
    async with aiohttp.ClientSession() as session:
        match_ids, (champ_map, ddragon_ver) = await asyncio.gather(
            _riot_get(
                session,
                f"{ASIA_BASE}/lol/match/v5/matches/by-puuid/{puuid}/ids",
                {"queue": queue_id, "count": count},
            ),
            _ensure_champ_cache(session),
        )

        sem = asyncio.Semaphore(5)
        raw_matches = await asyncio.gather(
            *[_safe_match_fetch(session, mid, sem) for mid in match_ids]
        )

    results: list[MatchResult] = []
    for match in raw_matches:
        if match is None:
            continue
        me = next(
            (p for p in match["info"]["participants"] if p["puuid"] == puuid), None
        )
        if me is None:
            continue
        champ_id = me.get("championId", 0)
        champ_name, champ_key = champ_map.get(champ_id, (me.get("championName", "?"), me.get("championName", "?")))
        pos = me.get("individualPosition", "")
        if pos in ("Invalid", "NONE", ""):
            pos = me.get("teamPosition", "")

        all_participants = match["info"]["participants"]
        team_id    = me["teamId"]
        team_kills = sum(p["kills"] for p in all_participants if p["teamId"] == team_id)
        kp         = round((me["kills"] + me["assists"]) / max(team_kills, 1) * 100)

        if me.get("pentaKills", 0):
            multikill = 5
        elif me.get("quadraKills", 0):
            multikill = 4
        elif me.get("tripleKills", 0):
            multikill = 3
        elif me.get("doubleKills", 0):
            multikill = 2
        else:
            multikill = 0

        results.append(
            MatchResult(
                win=me["win"],
                champion_name=champ_name,
                champion_key=champ_key,
                kills=me["kills"],
                deaths=me["deaths"],
                assists=me["assists"],
                cs=me.get("totalMinionsKilled", 0) + me.get("neutralMinionsKilled", 0),
                duration=match["info"].get("gameDuration", 0),
                position=pos,
                ddragon_version=ddragon_ver,
                kill_participation=kp,
                damage=me.get("totalDamageDealtToChampions", 0),
                multikill=multikill,
                grade=grade_player(me, all_participants, pos, me["win"]),
            )
        )
    return results
