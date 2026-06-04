import random
import datetime
import unicodedata
import discord
from discord.ext import commands

from api.database import SessionLocal
from api.crud.user_crud import get_user, register_user
from api.crud.attendance_crud import get_today_attendance, create_attendance
from api.crud.game_log_crud import get_recent_game_logs
from api.crud.gamble_log_crud import get_recent_gamble_logs
from api.schemas.user_schema import UserInfo
from api.schemas.game_log_schema import GameLogInfo, GameLogListInfo
from api.schemas.gamble_log_schema import GambleLogInfo, GambleLogListInfo


GAME_TYPE_KR   = {"chamchamcham": "참참참", "rsp": "가위바위보", "lotdraw": "제비뽑기"}
GAMBLE_TYPE_KR = {"holcham": "홀짝", "racing": "경마"}
_GAME_COL = 10  # "가위바위보" ea-width


def _ea_width(s: str) -> int:
    """한글·한자 등 전각 문자를 2로 계산한 표시 너비."""
    return sum(2 if unicodedata.east_asian_width(c) in ("W", "F") else 1 for c in s)


def _ea_ljust(s: str, width: int) -> str:
    return s + " " * max(width - _ea_width(s), 0)


def _ea_rjust(s: str, width: int) -> str:
    return " " * max(width - _ea_width(s), 0) + s


def _build_game_table(logs: list) -> str:
    header = f"{'#':>2}  {_ea_ljust('게임', _GAME_COL)}  결과  {'포인트':>6}"
    sep = "─" * _ea_width(header)
    rows = []
    for i, log in enumerate(logs, 1):
        game = _ea_ljust(GAME_TYPE_KR.get(log.game_type, log.game_type), _GAME_COL)
        if log.point > 0:
            pt = f"+{log.point}P"
        elif log.point < 0:
            pt = f"{log.point}P"
        else:
            pt = "±0P"
        rows.append(f"{i:>2}  {game}  {log.result}  {_ea_rjust(pt, 6)}")
    return "```\n" + "\n".join([header, sep, *rows]) + "\n```"


_GAMBLE_COL = 4  # "홀짝" ea-width


def _build_gamble_table(logs: list) -> str:
    header = f"{'#':>2}  {_ea_ljust('도박', _GAMBLE_COL)}  결과  {'포인트':>6}"
    sep = "─" * _ea_width(header)
    rows = []
    for i, log in enumerate(logs, 1):
        gamble = _ea_ljust(GAMBLE_TYPE_KR.get(log.gamble_type, log.gamble_type), _GAMBLE_COL)
        if log.point > 0:
            pt = f"+{log.point}P"
        elif log.point < 0:
            pt = f"{log.point}P"
        else:
            pt = "±0P"
        rows.append(f"{i:>2}  {gamble}  {log.result}  {_ea_rjust(pt, 6)}")
    return "```\n" + "\n".join([header, sep, *rows]) + "\n```"


class UserCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="등록")
    async def register(self, ctx: commands.Context):
        async with SessionLocal() as session:
            if await get_user(session, ctx.author.id) is not None:
                await ctx.reply("이미 등록된 유저입니다.", mention_author=False)
                return

            user = await register_user(session, ctx.author.id)

        embed = discord.Embed(
            title="✅ 등록 완료",
            description=f"{ctx.author.mention} 님, 환영합니다!\n시작 포인트 **1,000P** 가 지급됐어요.",
            color=discord.Color.green(),
        )
        embed.set_thumbnail(url=ctx.author.display_avatar.url)
        embed.set_footer(text=f"가입일: {user.created_at.strftime('%Y-%m-%d')}")
        await ctx.reply(embed=embed, mention_author=False)

    @commands.command(name="정보")
    async def info(self, ctx: commands.Context):
        async with SessionLocal() as session:
            user = await get_user(session, ctx.author.id)

        if user is None:
            await ctx.reply("`!등록` 명령어로 먼저 등록해주세요.", mention_author=False)
            return

        info = UserInfo(
            user_nickname=ctx.author.display_name,
            point=user.point,
            created_at=user.created_at,
        )

        embed = discord.Embed(
            title=info.user_nickname,
            color=discord.Color.blurple(),
        )
        embed.set_thumbnail(url=ctx.author.display_avatar.url)
        embed.add_field(name="💰 포인트", value=f"**{info.point:,} P**", inline=True)
        embed.add_field(
            name="📅 가입일",
            value=info.created_at.strftime("%Y년 %m월 %d일"),
            inline=True,
        )
        await ctx.reply(embed=embed, mention_author=False)

    @commands.command(name="출석")
    async def attendance(self, ctx: commands.Context):
        async with SessionLocal() as session:
            user = await get_user(session, ctx.author.id)
            if user is None:
                await ctx.reply("`!등록` 명령어로 먼저 등록해주세요.", mention_author=False)
                return

            if await get_today_attendance(session, ctx.author.id) is not None:
                await ctx.reply("오늘 이미 출석했습니다! 내일 다시 오세요 👋", mention_author=False)
                return

            is_jackpot = random.random() < 0.04
            point = 2000 if is_jackpot else 1000
            await create_attendance(session, ctx.author.id, point)
            new_total = user.point

        if is_jackpot:
            embed = discord.Embed(
                title="🎊 잭팟! 출석 완료",
                description="4% 확률의 잭팟 당첨! 포인트 2배 지급!",
                color=discord.Color.gold(),
            )
        else:
            embed = discord.Embed(
                title="✅ 출석 완료",
                color=discord.Color.green(),
            )

        embed.set_thumbnail(url=ctx.author.display_avatar.url)
        embed.add_field(name="획득 포인트", value=f"**+{point:,} P**", inline=True)
        embed.add_field(name="현재 포인트", value=f"**{new_total:,} P**", inline=True)
        embed.set_footer(text=f"{ctx.author.display_name} • {datetime.date.today()}")
        await ctx.reply(embed=embed, mention_author=False)

    @commands.command(name="게임기록")
    async def game_history(self, ctx: commands.Context):
        async with SessionLocal() as session:
            user = await get_user(session, ctx.author.id)
            if user is None:
                await ctx.reply("`!등록` 명령어로 먼저 등록해주세요.", mention_author=False)
                return

            logs = await get_recent_game_logs(session, ctx.author.id, limit=5)

        if not logs:
            await ctx.reply("게임 기록이 없습니다. `!게임` 으로 먼저 플레이해보세요!", mention_author=False)
            return

        wins = sum(1 for log in logs if log.result == "승리")
        win_rate = round(wins / len(logs) * 100, 1)

        user_info = UserInfo(
            user_nickname=ctx.author.display_name,
            point=user.point,
            created_at=user.created_at,
        )
        data = GameLogListInfo(
            user=user_info,
            game_log_list=[
                GameLogInfo(game_type=log.game_type, result=log.result, point=log.point)
                for log in logs
            ],
            win_rate=win_rate,
        )

        embed = discord.Embed(
            title=f"🎮 {data.user.user_nickname}의 게임 기록",
            color=discord.Color.blurple(),
        )
        embed.set_thumbnail(url=ctx.author.display_avatar.url)
        embed.add_field(name="최근 기록", value=_build_game_table(data.game_log_list), inline=False)
        embed.add_field(name="📊 승률", value=f"**{data.win_rate}%**", inline=True)
        embed.add_field(name="💰 보유 포인트", value=f"**{data.user.point:,} P**", inline=True)
        await ctx.reply(embed=embed, mention_author=False)

    @commands.command(name="도박기록")
    async def gamble_history(self, ctx: commands.Context):
        async with SessionLocal() as session:
            user = await get_user(session, ctx.author.id)
            if user is None:
                await ctx.reply("`!등록` 명령어로 먼저 등록해주세요.", mention_author=False)
                return

            logs = await get_recent_gamble_logs(session, ctx.author.id, limit=5)

        if not logs:
            await ctx.reply("도박 기록이 없습니다. `!도박` 으로 먼저 플레이해보세요!", mention_author=False)
            return

        wins = sum(1 for log in logs if log.point > 0)
        win_rate = round(wins / len(logs) * 100, 1)

        user_info = UserInfo(
            user_nickname=ctx.author.display_name,
            point=user.point,
            created_at=user.created_at,
        )
        data = GambleLogListInfo(
            user=user_info,
            gamble_log_list=[
                GambleLogInfo(
                    gamble_type=log.gamble_type,
                    result="승리" if log.point > 0 else "패배",
                    point=log.point,
                )
                for log in logs
            ],
            win_rate=win_rate,
        )

        embed = discord.Embed(
            title=f"🎰 {data.user.user_nickname}의 도박 기록",
            color=discord.Color.gold(),
        )
        embed.set_thumbnail(url=ctx.author.display_avatar.url)
        embed.add_field(name="최근 기록", value=_build_gamble_table(data.gamble_log_list), inline=False)
        embed.add_field(name="📊 승률", value=f"**{data.win_rate}%**", inline=True)
        embed.add_field(name="💰 보유 포인트", value=f"**{data.user.point:,} P**", inline=True)
        await ctx.reply(embed=embed, mention_author=False)


async def setup(bot: commands.Bot):
    await bot.add_cog(UserCog(bot))
