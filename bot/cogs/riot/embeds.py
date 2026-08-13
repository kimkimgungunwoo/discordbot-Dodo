import discord
from api.services.riot_api import SummonerProfile, QueueStats, MatchResult, POSITION_KR
from api.services.riot_stats import MatchStats

TIER_COLORS = {
    "IRON":        0x4A4A4A,
    "BRONZE":      0xA0522D,
    "SILVER":      0x9EB4C0,
    "GOLD":        0xCD8400,
    "PLATINUM":    0x4FC4CF,
    "EMERALD":     0x52B788,
    "DIAMOND":     0x576BCE,
    "MASTER":      0x9D48E0,
    "GRANDMASTER": 0xCF2424,
    "CHALLENGER":  0xF4C874,
}

TIER_BADGE = {
    "IRON": "⬛", "BRONZE": "🟫", "SILVER": "🩶",
    "GOLD": "🟨", "PLATINUM": "🩵", "EMERALD": "🟩",
    "DIAMOND": "🔷", "MASTER": "🟣", "GRANDMASTER": "🔴",
    "CHALLENGER": "🌟",
}

WIN_COLOR  = 0x3BA55C  # Discord green (muted)
LOSE_COLOR = 0xC94D47  # Muted red


def _score_color(avg_score: float) -> int:
    if avg_score >= 65:
        return 0x3BA55C
    if avg_score >= 45:
        return 0xFAA61A  # amber
    return 0xC94D47


def _emblem_url(tier: str | None) -> str:
    t = (tier or "unranked").lower()
    return f"https://opgg-static.akamaized.net/images/medals/{t}_1.png"


def _bar(ratio: float, length: int = 12) -> str:
    filled = max(0, min(length, round(ratio * length)))
    return "█" * filled + "░" * (length - filled)


def _rank_field(rank) -> str:
    if rank is None:
        return "**언랭**\n─────────"
    bar   = _bar(rank.lp / 100)
    badge = TIER_BADGE.get(rank.tier, "")
    return (
        f"{badge} **{rank.tier_kr}** · {rank.lp} LP\n"
        f"`{bar}`\n"
        f"{rank.wins}W {rank.losses}L · **{rank.win_rate}%**"
    )


def _ranked_total_field(rank) -> str:
    if rank is None:
        return "기록 없음"
    total = rank.wins + rank.losses
    wr    = round(rank.wins / total * 100, 1) if total else 0.0
    bar   = _bar(wr / 100)
    return f"{rank.wins}W {rank.losses}L ({total}게임)\n`{bar}` **{wr}%**"


def _recent_stats_field(qs: QueueStats) -> str:
    kda     = round((qs.avg_kills + qs.avg_assists) / max(qs.avg_deaths, 0.1), 2)
    win_bar = _bar(qs.win_rate / 100)
    return (
        f"{qs.wins}W {qs.losses}L ({qs.total_games}게임)\n"
        f"`{win_bar}` **{qs.win_rate}%**\n"
        f"포지션: **{qs.main_position_kr}** · KDA **{kda}**\n"
        f"`{qs.avg_kills} / {qs.avg_deaths} / {qs.avg_assists}`"
    )


def build_profile_embeds(profile: SummonerProfile) -> list[discord.Embed]:
    solo_rank  = profile.solo_rank
    flex_rank  = profile.flex_rank
    ref        = solo_rank or flex_rank
    tier_color = discord.Color(TIER_COLORS.get(ref.tier, 0x5865F2)) if ref else discord.Color.blurple()
    ver        = profile.ddragon_version

    e1 = discord.Embed(color=tier_color)
    e1.set_author(
        name=f"{profile.game_name}#{profile.tag_line}  ·  Lv. {profile.summoner_level}",
        icon_url=profile.profile_icon_url,
    )
    e1.set_thumbnail(url=_emblem_url(ref.tier if ref else None))
    e1.add_field(name="🏆 솔로랭크", value=_rank_field(solo_rank), inline=True)
    e1.add_field(name="🏅 자유랭크", value=_rank_field(flex_rank), inline=True)

    medals = ["🥇", "🥈", "🥉"]
    e2 = discord.Embed(title="🎯 챔피언 마스터리", color=0x7B2FBE)
    if profile.top_champions:
        for i, m in enumerate(profile.top_champions):
            lvl_bar = _bar(min(m.mastery_level, 7) / 7)
            e2.add_field(
                name=f"{medals[i]} {m.champion_name}",
                value=f"Lv. **{m.mastery_level}**\n`{lvl_bar}`\n{m.mastery_points:,} 점",
                inline=True,
            )
        e2.set_thumbnail(url=f"https://ddragon.leagueoflegends.com/cdn/{ver}/img/champion/{profile.top_champions[0].champion_key}.png")
    else:
        e2.description = "마스터리 정보 없음"

    e3 = discord.Embed(title="📋 시즌 전체전적", color=tier_color)
    e3.add_field(name="🏆 솔로랭크", value=_ranked_total_field(solo_rank), inline=True)
    e3.add_field(name="🏅 자유랭크", value=_ranked_total_field(flex_rank), inline=True)

    solo_s     = profile.solo_stats
    flex_s     = profile.flex_stats
    ref_s      = solo_s or flex_s
    stat_color = (WIN_COLOR if ref_s and ref_s.win_rate >= 50 else LOSE_COLOR) if ref_s else 0x5865F2

    e4 = discord.Embed(title="📊 최근 전적 분석 (최대 10게임)", color=stat_color)
    e4.add_field(
        name="🏆 솔로랭크",
        value=_recent_stats_field(solo_s) if solo_s else "최근 기록 없음",
        inline=True,
    )
    e4.add_field(
        name="🏅 자유랭크",
        value=_recent_stats_field(flex_s) if flex_s else "최근 기록 없음",
        inline=True,
    )

    return [e1, e2, e3, e4]


def build_match_embeds(
    matches: list[MatchResult],
    game_name: str,
    tag_line: str,
    queue_label: str,
) -> list[discord.Embed]:
    if not matches:
        e = discord.Embed(
            title=f"{game_name}#{tag_line} — {queue_label}",
            description="최근 게임 기록이 없습니다.",
            color=0x5865F2,
        )
        return [e]

    MULTIKILL_LABEL = {2: "더블킬", 3: "트리플킬", 4: "쿼드라킬", 5: "펜타킬"}

    embeds = []
    for i, m in enumerate(matches, 1):
        color  = WIN_COLOR if m.win else LOSE_COLOR
        result = "✅ 승리" if m.win else "❌ 패배"
        multi  = MULTIKILL_LABEL.get(m.multikill, "")
        pos    = m.position_kr if m.position_kr != "-" else "—"

        author = f"{result}  —  {m.champion_name}" + (f"  🎯 {multi}" if multi else "")
        stats  = (
            f"{m.grade}  **{m.score}점**  ·  "
            f"{m.kills}/{m.deaths}/{m.assists} ({m.kda})  ·  "
            f"관여 {m.kill_participation}%  ·  딜 {m.damage_str}  ·  "
            f"CS {m.cs}  ·  {m.duration_str}"
        )

        e = discord.Embed(color=color, description=stats)
        e.set_author(name=author, icon_url=m.champ_icon_url)
        e.set_footer(text=pos)
        embeds.append(e)

    return embeds


def build_stats_embeds(
    stats: MatchStats,
    game_name: str,
    tag_line: str,
    queue_label: str,
) -> list[discord.Embed]:
    base_color = _score_color(stats.avg_score)

    # ── Embed 1: 종합 성적 ──────────────────────────────
    e1 = discord.Embed(
        title=f"📊 {game_name}#{tag_line}  —  {queue_label} 최근 {stats.total}게임 분석",
        description=f"평균 점수  **{stats.avg_score}점**  (포지션 보정)",
        color=base_color,
    )
    e1.add_field(
        name="승률",
        value=f"{stats.wins}승 {stats.total - stats.wins}패\n**{stats.win_rate}%**",
        inline=True,
    )
    e1.add_field(
        name="평균 KDA",
        value=f"**{stats.avg_kda}**\nKP {stats.avg_kp}%",
        inline=True,
    )
    e1.add_field(
        name="평균 딜 · CS/분",
        value=f"{stats.avg_damage // 1000:.1f}k  ·  {stats.avg_cs_per_min}",
        inline=True,
    )

    # ── Embed 2: 캐리력 ─────────────────────────────────
    grade_line = (
        f"🔥 {stats.carry_count}판  "
        f"✅ {stats.good_count}판  "
        f"😐 {stats.normal_count}판  "
        f"💀🐀 {stats.bad_count}판"
    )
    e2 = discord.Embed(title="⚔️ 캐리력", color=base_color)
    e2.add_field(
        name="딜 기여율 · 팀 내 순위",
        value=f"평균 **{stats.avg_damage_share}%**  ·  팀 내 평균 **{stats.avg_dmg_rank}위**",
        inline=False,
    )
    e2.add_field(name="등급 분포", value=grade_line, inline=False)

    # ── Embed 3: 팀운 ───────────────────────────────────
    good_wr  = f"{stats.good_game_wins}승 {stats.good_game_total - stats.good_game_wins}패 ({stats.good_win_rate}%)" if stats.good_game_total else "기록 없음"
    bad_wr   = f"{stats.bad_game_wins}승 {stats.bad_game_total - stats.bad_game_wins}패 ({stats.bad_win_rate}%)" if stats.bad_game_total else "기록 없음"

    e3 = discord.Embed(title=f"🍀 팀운  —  {stats.luck_score}", color=base_color)
    e3.add_field(name="잘한 판 (캐리·활약)", value=f"{stats.good_game_total}판 중\n{good_wr}", inline=True)
    e3.add_field(name="못한 판 (발목·트롤)", value=f"{stats.bad_game_total}판 중\n{bad_wr}", inline=True)
    e3.add_field(
        name="통나무  ·  버스",
        value=f"**{stats.carry_loss}판**  ·  **{stats.bad_win}판**",
        inline=False,
    )

    # ── Embed 4: 트렌드 + 포지션/챔프 ───────────────────
    pos_kr = POSITION_KR.get(stats.main_position, stats.main_position)
    champ_lines = "  ".join(
        f"{name} {total}판 {w}승" for name, total, w in stats.top_champs
    ) or "기록 없음"

    recent_label = f"{stats.recent_wins}승 {5 - stats.recent_wins}패 ({stats.recent_win_rate}%)  KDA {stats.recent_avg_kda}"
    prev_label   = f"{stats.prev_wins}승 {(stats.total - 5) - stats.prev_wins}패 ({stats.prev_win_rate}%)  KDA {stats.prev_avg_kda}" if stats.total >= 6 else "데이터 부족"

    e4 = discord.Embed(title=f"📈 트렌드  —  {stats.trend_arrow}", color=base_color)
    e4.add_field(name="최근 5판", value=recent_label, inline=False)
    e4.add_field(name="이전 5판", value=prev_label,   inline=False)
    e4.add_field(
        name="주 포지션",
        value=f"{pos_kr}  ({stats.main_pos_total}판 · {stats.main_pos_win_rate}%)",
        inline=True,
    )
    e4.add_field(name="주요 챔프", value=champ_lines, inline=True)

    return [e1, e2, e3, e4]
