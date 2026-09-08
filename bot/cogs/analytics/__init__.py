import discord
from discord.ext import commands
import asyncio
import datetime
import itertools
import time

from bot.cogs.control import category_embed
from bot.cogs.util import GENERATING_MSG
from api.database import SessionLocal
from api.crud.analytics_crud import (
    increment_chat_stat, scan_chat_stats, delete_all_chat_stats,
    increment_chat_hourly, increment_chat_hourly_by_hour, scan_chat_hourly,
    get_chat_hourly_for_user, delete_all_chat_hourly, kst_hour,
    start_voice_session, close_voice_session, find_open_voice_session,
    scan_open_voice_sessions, drop_voice_session, _voice_hourly_chunks,
    scan_voice_stats, scan_voice_hourly, get_voice_hourly_for_user,
    add_voice_pair, scan_voice_pairs, scan_game_stats,
    start_game_session, end_game_session, drop_game_session, scan_open_game_sessions,
    get_backfill_progress, set_backfill_progress, delete_all_backfill_progress,
)
from api.models.voice_stat import VoiceStat
from api.models.voice_pair import VoicePair
from api.models.game_stat import GameStat
from bot.cogs.analytics.renderer import (
    render_overview_card, render_user_stat_card, render_server_overall_card, format_duration,
)

_BACKFILL_BATCH = 200
_RANK_LIMIT = 15
_SCAN_TTL = 30
_MEMBER_TTL = 600
_MAX_ELAPSED = 24 * 3600
_TOP_GAMES = 5
_TOP_MATES = 5


def _game_name(member: discord.Member) -> str | None:
    for act in member.activities:
        if act.type == discord.ActivityType.playing and act.name:
            return act.name.strip()
    return None


class Analytics(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.active_voice: dict[int, tuple[str, datetime.datetime]] = {}
        self._backfill_tasks: dict[int, asyncio.Task] = {}
        self._member_cache: dict[int, tuple[float, tuple[str, str]]] = {}
        self._scan_cache: dict[str, tuple[float, list]] = {}
        self._ready = asyncio.Event()
        self._vc: dict[int, tuple[set[int], datetime.datetime]] = {}
        self._playing: dict[int, tuple[str, datetime.datetime]] = {}

    async def cog_load(self):
        if self.bot.is_ready():
            await self._reconcile()

    async def cog_unload(self):
        for task in self._backfill_tasks.values():
            task.cancel()

    async def _resolve_member(self, guild: discord.Guild, user_id: int) -> tuple[str, str]:
        member = guild.get_member(user_id)
        if member is not None:
            return member.display_name, member.display_avatar.url

        cached = self._member_cache.get(user_id)
        if cached and time.monotonic() - cached[0] < _MEMBER_TTL:
            return cached[1]

        try:
            member = await guild.fetch_member(user_id)
            result = (member.display_name, member.display_avatar.url)
        except discord.HTTPException:
            try:
                user = await self.bot.fetch_user(user_id)
                result = (f"{user.name} (나감)", user.display_avatar.url)
            except discord.HTTPException:
                result = (f"알 수 없음({user_id})", "")
        self._member_cache[user_id] = (time.monotonic(), result)
        return result

    async def _cached(self, key: str, scan_fn):
        hit = self._scan_cache.get(key)
        if hit and time.monotonic() - hit[0] < _SCAN_TTL:
            return hit[1]
        async with SessionLocal() as session:
            data = await scan_fn(session)
        self._scan_cache[key] = (time.monotonic(), data)
        return data

    async def _chat_stats(self):
        return await self._cached("chat_stat", scan_chat_stats)

    async def _voice_stats(self):
        return await self._cached("voice_stat", scan_voice_stats)

    async def _chat_hourly(self):
        return await self._cached("chat_hourly", scan_chat_hourly)

    async def _voice_hourly(self):
        return await self._cached("voice_hourly", scan_voice_hourly)

    async def _voice_pairs(self):
        return await self._cached("voice_pair", scan_voice_pairs)

    async def _game_stats(self):
        return await self._cached("game_stat", scan_game_stats)

    async def _flush_pairs(self, channel_id: int, now: datetime.datetime):
        entry = self._vc.get(channel_id)
        if not entry:
            return
        members, since = entry
        elapsed = min(int((now - since).total_seconds()), _MAX_ELAPSED)
        if elapsed <= 0 or len(members) < 2:
            return
        async with SessionLocal() as session:
            for a, b in itertools.combinations(sorted(members), 2):
                await add_voice_pair(session, a, b, elapsed)

    async def _join_channel(self, uid: int, channel_id: int, now: datetime.datetime, game: str | None = None):
        await self._flush_pairs(channel_id, now)
        members = self._vc.get(channel_id, (set(), now))[0]
        members.add(uid)
        self._vc[channel_id] = (members, now)
        async with SessionLocal() as session:
            sk = await start_voice_session(session, uid, now, channel_id)
            if game:
                await start_game_session(session, uid, game, now)
        self.active_voice[uid] = (sk, now)
        if game:
            self._playing[uid] = (game, now)

    async def _leave_channel(self, uid: int, channel_id: int, now: datetime.datetime, moving: bool):
        await self._flush_pairs(channel_id, now)
        entry = self._vc.get(channel_id)
        if entry:
            entry[0].discard(uid)
            self._vc[channel_id] = (entry[0], now)
        sk_entry = self.active_voice.pop(uid, None)
        async with SessionLocal() as session:
            sk = sk_entry[0] if sk_entry else getattr(await find_open_voice_session(session, uid), "sk", None)
            if sk:
                await close_voice_session(session, uid, sk, now, bump_count=not moving)

    async def _flush_game(self, uid: int, now: datetime.datetime):
        self._playing.pop(uid, None)
        async with SessionLocal() as session:
            await end_game_session(session, uid, now)

    @commands.Cog.listener()
    async def on_ready(self):
        await self._reconcile()

    async def _reconcile(self):
        try:
            now = datetime.datetime.utcnow()
            for guild in self.bot.guilds:
                async with SessionLocal() as session:
                    open_sessions = await scan_open_voice_sessions(session)
                    known_sks = {sk for sk, _ in self.active_voice.values()}
                    live: dict[int, int] = {}

                    for vc in guild.voice_channels:
                        mset = {m.id for m in vc.members if not m.bot}
                        if not mset:
                            continue
                        self._vc[vc.id] = (mset, now)
                        for uid in mset:
                            live[uid] = vc.id

                    for s in open_sessions:
                        if s.sk in known_sks:
                            continue
                        if s.user_id in live:
                            self.active_voice[s.user_id] = (s.sk, s.joined_at)  # 아직 통화 중 → 이어받기
                        else:
                            await drop_voice_session(session, s.user_id, s.sk)  # 봇 꺼진 동안 나감

                    for uid, ch_id in live.items():
                        if uid in self.active_voice:
                            continue
                        sk = await start_voice_session(session, uid, now, ch_id)
                        self.active_voice[uid] = (sk, now)

                    for gs in await scan_open_game_sessions(session):
                        m = guild.get_member(gs.user_id) if gs.user_id in live else None
                        if m and _game_name(m) == gs.game_name:
                            self._playing[gs.user_id] = (gs.game_name, gs.started_at)  # 같은 게임 계속 → 이어받기
                        else:
                            await drop_game_session(session, gs.user_id)  # 바뀜/중단/통화 나감

                    for uid in live:
                        if uid in self._playing:
                            continue
                        m = guild.get_member(uid)
                        if m and (g := _game_name(m)):
                            self._playing[uid] = (g, now)
                            await start_game_session(session, uid, g, now)
        finally:
            self._ready.set()

    def _live_voice_secs(self, user_id: int | None = None) -> dict[int, int]:
        now = datetime.datetime.utcnow()
        out: dict[int, int] = {}
        for uid, (_, joined_at) in self.active_voice.items():
            if user_id is not None and uid != user_id:
                continue
            d = min(int((now - joined_at).total_seconds()), _MAX_ELAPSED)
            if d > 0:
                out[uid] = d
        return out

    def _live_voice_hourly(self, user_id: int | None = None) -> dict[int, int]:
        now = datetime.datetime.utcnow()
        out: dict[int, int] = {}
        for uid, (_, joined_at) in self.active_voice.items():
            if user_id is not None and uid != user_id:
                continue
            for hour, sec in _voice_hourly_chunks(joined_at, now):
                out[hour] = out.get(hour, 0) + sec
        return out

    async def _voice_stats_live(self) -> list:
        extra = self._live_voice_secs()
        base = await self._voice_stats()
        if not extra:
            return base
        seen = set()
        out = []
        for s in base:
            add = extra.get(s.user_id, 0)
            out.append(VoiceStat(s.user_id, s.total_seconds + add, s.session_count, s.last_left_at))
            seen.add(s.user_id)
        for uid, d in extra.items():
            if uid not in seen:
                out.append(VoiceStat(uid, d, 0, None))
        return out

    async def _game_stats_live(self) -> list:
        base = list(await self._game_stats())
        now = datetime.datetime.utcnow()
        for uid, (game, since) in self._playing.items():
            d = min(int((now - since).total_seconds()), _MAX_ELAPSED)
            if d > 0:
                base.append(GameStat(uid, game, d))
        return base

    async def _voice_pairs_live(self) -> list:
        base = await self._voice_pairs()
        now = datetime.datetime.utcnow()
        extra: dict[tuple[int, int], int] = {}
        for members, since in self._vc.values():
            if len(members) < 2:
                continue
            d = min(int((now - since).total_seconds()), _MAX_ELAPSED)
            if d <= 0:
                continue
            for a, b in itertools.combinations(sorted(members), 2):
                extra[(a, b)] = extra.get((a, b), 0) + d
        if not extra:
            return base
        out = []
        for p in base:
            add = extra.pop((p.a, p.b), 0)
            out.append(VoicePair(p.a, p.b, p.total_seconds + add) if add else p)
        for (a, b), d in extra.items():
            out.append(VoicePair(a, b, d))
        return out

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        async with SessionLocal() as session:
            await increment_chat_stat(session, message.author.id, message.created_at)
            await increment_chat_hourly(session, message.author.id, message.created_at)

    @commands.Cog.listener()
    async def on_voice_state_update(
        self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState,
    ):
        if member.bot:
            return
        await self._ready.wait()
        bc, ac = before.channel, after.channel
        if bc == ac:
            return
        now = datetime.datetime.utcnow()
        if bc is not None:
            await self._leave_channel(member.id, bc.id, now, moving=ac is not None)
            if ac is None:
                await self._flush_game(member.id, now)
        if ac is not None:
            game = _game_name(member) if bc is None else None
            await self._join_channel(member.id, ac.id, now, game)

    @commands.Cog.listener()
    async def on_presence_update(self, before: discord.Member, after: discord.Member):
        if after.bot:
            return
        await self._ready.wait()
        if after.id not in self.active_voice:  # 통화방에 있을 때만 게임 집계
            self._playing.pop(after.id, None)
            return
        new_game = _game_name(after)
        if new_game == (self._playing.get(after.id) or (None,))[0]:
            return
        now = datetime.datetime.utcnow()
        await self._flush_game(after.id, now)
        if new_game:
            self._playing[after.id] = (new_game, now)
            async with SessionLocal() as session:
                await start_game_session(session, after.id, new_game, now)

    async def _ensure_backfill(self, guild: discord.Guild):
        task = self._backfill_tasks.get(guild.id)
        if task is None:
            task = asyncio.create_task(self._run_backfill(guild))
            self._backfill_tasks[guild.id] = task
        await task

    async def _run_backfill(self, guild: discord.Guild):
        cutoff_id = discord.utils.time_snowflake(datetime.datetime.utcnow())
        print(f"[Analytics] 백필 시작: guild={guild.name} 채널 {len(guild.text_channels)}개")
        grand_total = 0
        for channel in guild.text_channels:
            try:
                count = await self._backfill_channel(channel, cutoff_id)
                grand_total += count
            except discord.Forbidden:
                print(f"[Analytics] 백필 스킵(권한 없음): #{channel.name} ({channel.id})")
            except Exception as e:
                print(f"[Analytics] 백필 실패 channel=#{channel.name}({channel.id}): {e}")
        print(f"[Analytics] 백필 완료: guild={guild.name} 총 {grand_total:,}개 메시지 반영")

    async def _backfill_channel(self, channel: discord.TextChannel, cutoff_id: int) -> int:
        async with SessionLocal() as session:
            progress = await get_backfill_progress(session, channel.id)
        if progress and progress.done:
            return 0

        before_id = progress.cursor_id if progress else cutoff_id
        pending: dict[int, int] = {}
        pending_hourly: dict[tuple[int, int], int] = {}
        last_id = before_id
        since_flush = 0
        channel_total = 0

        async for msg in channel.history(limit=None, before=discord.Object(id=before_id)):
            if not msg.author.bot:
                pending[msg.author.id] = pending.get(msg.author.id, 0) + 1
                key = (msg.author.id, kst_hour(msg.created_at))
                pending_hourly[key] = pending_hourly.get(key, 0) + 1
                channel_total += 1
            last_id = msg.id
            since_flush += 1
            if since_flush >= _BACKFILL_BATCH:
                await self._flush_backfill(channel.id, pending, pending_hourly, last_id, done=False)
                pending.clear()
                pending_hourly.clear()
                since_flush = 0

        await self._flush_backfill(channel.id, pending, pending_hourly, last_id, done=True)
        print(f"[Analytics] 백필 완료: #{channel.name} ({channel.id}) — {channel_total:,}개 메시지")
        return channel_total

    async def _flush_backfill(
        self, channel_id: int, pending: dict[int, int], pending_hourly: dict[tuple[int, int], int],
        cursor_id: int, done: bool,
    ):
        async with SessionLocal() as session:
            now = datetime.datetime.utcnow()
            for user_id, count in pending.items():
                await increment_chat_stat(session, user_id, now, count=count)
            for (user_id, hour), count in pending_hourly.items():
                await increment_chat_hourly_by_hour(session, user_id, hour, count=count)
            await set_backfill_progress(session, channel_id, cursor_id, done)

    @commands.group(name="통계", invoke_without_command=True)
    async def stat_group(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("analytics", ctx.clean_prefix), mention_author=False)

    @stat_group.command(name="재분석")
    async def reanalyze(self, ctx: commands.Context):
        msg = await ctx.reply("🔄 처리중입니다...", mention_author=False)
        old_task = self._backfill_tasks.pop(ctx.guild.id, None)
        if old_task and not old_task.done():
            old_task.cancel()
        async with SessionLocal() as session:
            await delete_all_chat_stats(session)
            await delete_all_chat_hourly(session)
            await delete_all_backfill_progress(session)
        self._scan_cache.clear()
        await self._ensure_backfill(ctx.guild)
        await msg.edit(content="✅ 완료되었습니다.")

    @stat_group.command(name="채팅통계")
    async def chat_overall(self, ctx: commands.Context):
        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        await self._ensure_backfill(ctx.guild)
        stats = await self._chat_stats()
        hourly_rows = await self._chat_hourly()

        rows, total, avg = await self._build_rank_rows(ctx.guild, stats, key=lambda s: s.message_count, fmt=lambda v: f"{v:,}개")
        hourly = _build_hourly(hourly_rows, key=lambda r: r.message_count)
        img = await render_overview_card(
            kind="chat", guild_name=ctx.guild.name, guild_icon=_guild_icon(ctx.guild),
            total_label=f"{total:,}개", active_count=len(stats),
            avg_label=f"{avg:,.0f}개", rows=rows, hourly=hourly,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "chat_overall.png")])

    @stat_group.command(name="통화통계")
    async def voice_overall(self, ctx: commands.Context):
        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        stats = await self._voice_stats_live()
        hourly_rows = await self._voice_hourly()
        rows, total, avg = await self._build_rank_rows(
            ctx.guild, stats, key=lambda s: s.total_seconds, fmt=format_duration,
        )
        hourly = _build_hourly(hourly_rows, key=lambda r: r.total_seconds, extra=self._live_voice_hourly())
        img = await render_overview_card(
            kind="voice", guild_name=ctx.guild.name, guild_icon=_guild_icon(ctx.guild),
            total_label=format_duration(total), active_count=len(stats),
            avg_label=format_duration(avg), rows=rows, hourly=hourly,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "voice_overall.png")])

    @stat_group.command(name="서버전체통계")
    async def server_overall(self, ctx: commands.Context):
        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        await self._ensure_backfill(ctx.guild)
        chat_stats = await self._chat_stats()
        voice_stats = await self._voice_stats_live()
        chat_hourly = _build_hourly(await self._chat_hourly(), key=lambda r: r.message_count)
        voice_hourly = _build_hourly(await self._voice_hourly(), key=lambda r: r.total_seconds, extra=self._live_voice_hourly())

        chat_total = sum(s.message_count for s in chat_stats)
        voice_total = sum(s.total_seconds for s in voice_stats)
        top_chat = []
        for s in sorted(chat_stats, key=lambda s: s.message_count, reverse=True)[:5]:
            name, _ = await self._resolve_member(ctx.guild, s.user_id)
            top_chat.append((name, f"{s.message_count:,}개"))
        top_voice = []
        for s in sorted(voice_stats, key=lambda s: s.total_seconds, reverse=True)[:5]:
            name, _ = await self._resolve_member(ctx.guild, s.user_id)
            top_voice.append((name, format_duration(s.total_seconds)))

        best_couple = await self._best_couple(ctx.guild)
        top_games = _rank_games(await self._game_stats_live(), limit=_TOP_GAMES)

        img = await render_server_overall_card(
            guild_name=ctx.guild.name, guild_icon=_guild_icon(ctx.guild), member_count=ctx.guild.member_count,
            chat_total_label=f"{chat_total:,}개", chat_active_count=len(chat_stats),
            voice_total_label=format_duration(voice_total), voice_active_count=len(voice_stats),
            top_chat=top_chat, top_voice=top_voice,
            chat_hourly=chat_hourly, voice_hourly=voice_hourly,
            best_couple=best_couple, top_games=top_games,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "server_overall.png")])

    @stat_group.command(name="유저통계")
    async def user_stat(self, ctx: commands.Context):
        await ctx.reply("통계를 볼 유저를 선택하세요:", view=UserStatPickView(self), mention_author=False)

    async def _user_stat_image(self, guild: discord.Guild, user_id: int):
        all_chat = await self._chat_stats()
        all_voice = await self._voice_stats_live()
        async with SessionLocal() as session:
            chat_hourly_rows = await get_chat_hourly_for_user(session, user_id)
            voice_hourly_rows = await get_voice_hourly_for_user(session, user_id)
        chat = next((s for s in all_chat if s.user_id == user_id), None)
        voice = next((s for s in all_voice if s.user_id == user_id), None)
        mates = await self._mate_rows(guild, user_id, await self._voice_pairs_live())
        if chat is None and voice is None and not mates:
            return None

        message_rank, message_total = _rank_of(all_chat, user_id, key=lambda s: s.message_count)
        voice_rank, voice_total = _rank_of(all_voice, user_id, key=lambda s: s.total_seconds)
        name, avatar = await self._resolve_member(guild, user_id)
        chat_hourly = _build_hourly(chat_hourly_rows, key=lambda r: r.message_count)
        voice_hourly = _build_hourly(voice_hourly_rows, key=lambda r: r.total_seconds, extra=self._live_voice_hourly(user_id))

        return await render_user_stat_card(
            name=name,
            avatar=avatar,
            message_count=chat.message_count if chat else 0,
            message_rank=message_rank, message_total_users=message_total,
            voice_seconds=voice.total_seconds if voice else 0,
            voice_rank=voice_rank, voice_total_users=voice_total,
            session_count=voice.session_count if voice else 0,
            chat_hourly=chat_hourly, voice_hourly=voice_hourly,
            mates=mates,
        )

    async def _best_couple(self, guild: discord.Guild) -> dict | None:
        pairs = await self._voice_pairs_live()
        if not pairs:
            return None
        top = max(pairs, key=lambda p: p.total_seconds)
        if top.total_seconds <= 0:
            return None
        na, aa = await self._resolve_member(guild, top.a)
        nb, ab = await self._resolve_member(guild, top.b)
        return {"name_a": na, "avatar_a": aa, "name_b": nb, "avatar_b": ab,
                "label": format_duration(top.total_seconds)}

    async def _mate_rows(self, guild: discord.Guild, user_id: int, pairs: list) -> list[dict]:
        mine = [
            (p.b if p.a == user_id else p.a, p.total_seconds)
            for p in pairs if user_id in (p.a, p.b) and p.total_seconds > 0
        ]
        mine.sort(key=lambda x: x[1], reverse=True)
        total = sum(s for _, s in mine)
        if not total:
            return []
        rows = []
        for i, (other_id, sec) in enumerate(mine[:_TOP_MATES]):
            name, _ = await self._resolve_member(guild, other_id)
            rows.append({"name": name, "label": format_duration(sec),
                         "pct": round(sec / total * 100, 1), "opacity": max(1 - i * 0.16, 0.2)})
        if len(mine) > _TOP_MATES:
            rest = sum(s for _, s in mine[_TOP_MATES:])
            rows.append({"name": "기타", "label": format_duration(rest),
                         "pct": round(rest / total * 100, 1), "opacity": 0.18})
        return rows

    async def _build_rank_rows(self, guild: discord.Guild, stats: list, *, key, fmt):
        ranked = sorted(stats, key=key, reverse=True)
        total = sum(key(s) for s in ranked)
        avg = total / len(ranked) if ranked else 0
        top = ranked[:_RANK_LIMIT]
        best = key(top[0]) if top else 1
        rows = []
        for s in top:
            name, avatar = await self._resolve_member(guild, s.user_id)
            rows.append({
                "name": name,
                "avatar": avatar,
                "value_label": fmt(key(s)),
                "pct": round(key(s) / max(best, 1) * 100, 1),
            })
        return rows, total, avg


def _build_hourly(rows: list, *, key, extra: dict[int, int] | None = None) -> list[dict]:
    by_hour: dict[int, int] = {}
    for r in rows:
        by_hour[r.hour] = by_hour.get(r.hour, 0) + key(r)
    for h, v in (extra or {}).items():
        by_hour[h] = by_hour.get(h, 0) + v
    values = [by_hour.get(h, 0) for h in range(24)]
    best = max(values) or 1
    return [{"hour": h, "pct": round(values[h] / best * 100, 1)} for h in range(24)]


def _guild_icon(guild: discord.Guild) -> str:
    return guild.icon.url if guild.icon else ""


def _rank_of(stats: list, user_id: int, *, key) -> tuple[int | None, int]:
    ranked = sorted(stats, key=key, reverse=True)
    for i, s in enumerate(ranked, 1):
        if s.user_id == user_id:
            return i, len(ranked)
    return None, len(ranked)


_GAME_COLORS = ["#f0a641", "#5aa9e6", "#63c187", "#c98bdb", "#ef7a7a", "#7f8896"]


def _rank_games(stats: list, *, limit: int) -> list[dict]:
    by_game: dict[str, int] = {}
    for g in stats:
        by_game[g.game_name] = by_game.get(g.game_name, 0) + g.total_seconds
    ranked = sorted(by_game.items(), key=lambda x: x[1], reverse=True)
    total = sum(v for _, v in ranked)
    if not total:
        return []
    head = ranked[:limit]
    out = [
        {"name": name, "pct": round(sec / total * 100, 1),
         "label": format_duration(sec), "color": _GAME_COLORS[i]}
        for i, (name, sec) in enumerate(head)
    ]
    rest = total - sum(sec for _, sec in head)
    if rest > 0:
        out.append({"name": "기타", "pct": round(rest / total * 100, 1),
                    "label": format_duration(rest), "color": _GAME_COLORS[-1]})
    return out


class UserStatPickView(discord.ui.View):
    def __init__(self, cog: "Analytics"):
        super().__init__(timeout=120)
        self.cog = cog

    @discord.ui.select(cls=discord.ui.UserSelect, placeholder="통계를 볼 유저를 선택하세요", min_values=1, max_values=1)
    async def pick(self, interaction: discord.Interaction, select: discord.ui.UserSelect):
        member = select.values[0]
        await interaction.response.defer()
        msg = await interaction.followup.send(GENERATING_MSG, wait=True)
        await self.cog._ensure_backfill(interaction.guild)
        img = await self.cog._user_stat_image(interaction.guild, member.id)
        if img is None:
            await msg.edit(content=f"**{member.display_name}** 의 기록이 아직 없습니다.")
            return
        await msg.edit(content=None, attachments=[discord.File(img, "user_stat.png")])


async def setup(bot: commands.Bot):
    await bot.add_cog(Analytics(bot))
