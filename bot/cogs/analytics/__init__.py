import discord
from discord.ext import commands
import asyncio
import datetime

from bot.cogs.control import category_embed
from bot.cogs.util import GENERATING_MSG
from api.database import SessionLocal
from api.crud.analytics_crud import (
    increment_chat_stat, get_chat_stat, scan_chat_stats, delete_all_chat_stats,
    start_voice_session, close_voice_session, find_open_voice_session,
    get_voice_stat, scan_voice_stats,
    get_backfill_progress, set_backfill_progress, delete_all_backfill_progress,
)
from bot.cogs.analytics.renderer import (
    render_overview_card, render_user_stat_card, render_server_overall_card, format_duration,
)
from bot.cogs.analytics.views import UserPickView

_BACKFILL_BATCH = 200
_RANK_LIMIT = 15
_PICK_LIMIT = 25


class Analytics(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.active_voice: dict[int, tuple[str, datetime.datetime]] = {}
        self._backfill_tasks: dict[int, asyncio.Task] = {}
        self._member_cache: dict[int, tuple[str, str]] = {}

    async def _resolve_member(self, guild: discord.Guild, user_id: int) -> tuple[str, str]:
        if user_id in self._member_cache:
            return self._member_cache[user_id]
        member = guild.get_member(user_id)
        if member is None:
            try:
                member = await guild.fetch_member(user_id)
            except discord.HTTPException:
                member = None
        if member is not None:
            result = (member.display_name, member.display_avatar.url)
        else:
            try:
                user = await self.bot.fetch_user(user_id)
                result = (f"{user.name} (나감)", user.display_avatar.url)
            except discord.HTTPException:
                result = (f"알 수 없음({user_id})", "")
        self._member_cache[user_id] = result
        return result

    @commands.Cog.listener()
    async def on_ready(self):
        for guild in self.bot.guilds:
            for vc in guild.voice_channels:
                for member in vc.members:
                    if member.bot or member.id in self.active_voice:
                        continue
                    now = datetime.datetime.utcnow()
                    async with SessionLocal() as session:
                        sk = await start_voice_session(session, member.id, now)
                    self.active_voice[member.id] = (sk, now)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        async with SessionLocal() as session:
            await increment_chat_stat(session, message.author.id, message.created_at)

    @commands.Cog.listener()
    async def on_voice_state_update(
        self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState,
    ):
        if member.bot:
            return
        now = datetime.datetime.utcnow()

        if before.channel is None and after.channel is not None:
            async with SessionLocal() as session:
                sk = await start_voice_session(session, member.id, now)
            self.active_voice[member.id] = (sk, now)

        elif before.channel is not None and after.channel is None:
            entry = self.active_voice.pop(member.id, None)
            async with SessionLocal() as session:
                if entry:
                    sk, _ = entry
                    await close_voice_session(session, member.id, sk, now)
                else:
                    open_session = await find_open_voice_session(session, member.id)
                    if open_session:
                        await close_voice_session(session, member.id, open_session.sk, now)

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
        last_id = before_id
        since_flush = 0
        channel_total = 0

        async for msg in channel.history(limit=None, before=discord.Object(id=before_id)):
            if not msg.author.bot:
                pending[msg.author.id] = pending.get(msg.author.id, 0) + 1
                channel_total += 1
            last_id = msg.id
            since_flush += 1
            if since_flush >= _BACKFILL_BATCH:
                await self._flush_backfill(channel.id, pending, last_id, done=False)
                pending.clear()
                since_flush = 0

        await self._flush_backfill(channel.id, pending, last_id, done=True)
        print(f"[Analytics] 백필 완료: #{channel.name} ({channel.id}) — {channel_total:,}개 메시지")
        return channel_total

    async def _flush_backfill(self, channel_id: int, pending: dict[int, int], cursor_id: int, done: bool):
        async with SessionLocal() as session:
            now = datetime.datetime.utcnow()
            for user_id, count in pending.items():
                await increment_chat_stat(session, user_id, now, count=count)
            await set_backfill_progress(session, channel_id, cursor_id, done)

    @commands.group(name="통계", invoke_without_command=True)
    async def stat_group(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("analytics"), mention_author=False)

    @stat_group.command(name="재분석")
    async def reanalyze(self, ctx: commands.Context):
        msg = await ctx.reply("🔄 처리중입니다...", mention_author=False)
        old_task = self._backfill_tasks.pop(ctx.guild.id, None)
        if old_task and not old_task.done():
            old_task.cancel()
        async with SessionLocal() as session:
            await delete_all_chat_stats(session)
            await delete_all_backfill_progress(session)
        await self._ensure_backfill(ctx.guild)
        await msg.edit(content="✅ 완료되었습니다.")

    @stat_group.command(name="채팅전체통계")
    async def chat_overall(self, ctx: commands.Context):
        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        await self._ensure_backfill(ctx.guild)
        async with SessionLocal() as session:
            stats = await scan_chat_stats(session)

        rows, total, avg = await self._build_rank_rows(ctx.guild, stats, key=lambda s: s.message_count, fmt=lambda v: f"{v:,}개")
        img = await render_overview_card(
            kind="chat", guild_name=ctx.guild.name, guild_icon=_guild_icon(ctx.guild),
            total_label=f"{total:,}개", active_count=len(stats),
            avg_label=f"{avg:,.0f}개", rows=rows,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "chat_overall.png")])

    @stat_group.command(name="통화통계")
    async def voice_overall(self, ctx: commands.Context):
        async with SessionLocal() as session:
            stats = await scan_voice_stats(session)

        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        rows, total, avg = await self._build_rank_rows(
            ctx.guild, stats, key=lambda s: s.total_seconds, fmt=format_duration,
        )
        img = await render_overview_card(
            kind="voice", guild_name=ctx.guild.name, guild_icon=_guild_icon(ctx.guild),
            total_label=format_duration(total), active_count=len(stats),
            avg_label=format_duration(avg), rows=rows,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "voice_overall.png")])

    @stat_group.command(name="서버전체통계")
    async def server_overall(self, ctx: commands.Context):
        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        await self._ensure_backfill(ctx.guild)
        async with SessionLocal() as session:
            chat_stats = await scan_chat_stats(session)
            voice_stats = await scan_voice_stats(session)

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
        img = await render_server_overall_card(
            guild_name=ctx.guild.name, guild_icon=_guild_icon(ctx.guild), member_count=ctx.guild.member_count,
            chat_total_label=f"{chat_total:,}개", chat_active_count=len(chat_stats),
            voice_total_label=format_duration(voice_total), voice_active_count=len(voice_stats),
            top_chat=top_chat, top_voice=top_voice,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "server_overall.png")])

    @stat_group.command(name="유저통계")
    async def user_stat(self, ctx: commands.Context):
        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        await self._ensure_backfill(ctx.guild)
        async with SessionLocal() as session:
            chat_stats = await scan_chat_stats(session)
            voice_stats = await scan_voice_stats(session)

        chat_map = {s.user_id: s.message_count for s in chat_stats}
        voice_map = {s.user_id: s.total_seconds for s in voice_stats}
        active_ids = set(chat_map) | set(voice_map)
        if not active_ids:
            await msg.edit(content="아직 기록된 통계가 없습니다.")
            return

        entries = []
        for uid in active_ids:
            name, _ = await self._resolve_member(ctx.guild, uid)
            entries.append((uid, name, chat_map.get(uid, 0)))
        entries.sort(key=lambda e: e[2], reverse=True)
        entries = entries[:_PICK_LIMIT]

        view = UserPickView(self, entries)
        await msg.edit(content="통계를 확인할 유저를 선택하세요:", view=view)

    async def show_user_stat(self, interaction: discord.Interaction, user_id: int):
        async with SessionLocal() as session:
            chat = await get_chat_stat(session, user_id)
            voice = await get_voice_stat(session, user_id)
            all_chat = await scan_chat_stats(session)
            all_voice = await scan_voice_stats(session)

        msg = await interaction.followup.send(GENERATING_MSG, wait=True)

        message_rank, message_total = _rank_of(all_chat, user_id, key=lambda s: s.message_count)
        voice_rank, voice_total = _rank_of(all_voice, user_id, key=lambda s: s.total_seconds)
        name, avatar = await self._resolve_member(interaction.guild, user_id)

        img = await render_user_stat_card(
            name=name,
            avatar=avatar,
            message_count=chat.message_count if chat else 0,
            message_rank=message_rank, message_total_users=message_total,
            voice_seconds=voice.total_seconds if voice else 0,
            voice_rank=voice_rank, voice_total_users=voice_total,
            session_count=voice.session_count if voice else 0,
        )
        await msg.edit(content=None, attachments=[discord.File(img, "user_stat.png")])

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


def _guild_icon(guild: discord.Guild) -> str:
    return guild.icon.url if guild.icon else ""


def _rank_of(stats: list, user_id: int, *, key) -> tuple[int | None, int]:
    ranked = sorted(stats, key=key, reverse=True)
    for i, s in enumerate(ranked, 1):
        if s.user_id == user_id:
            return i, len(ranked)
    return None, len(ranked)


async def setup(bot: commands.Bot):
    await bot.add_cog(Analytics(bot))
