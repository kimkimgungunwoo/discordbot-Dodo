import discord
from discord.ext import commands
import random

from api.database import SessionLocal
from api.crud.user_crud import get_user
from api.crud.game_log_crud import create_game_log
from api.models.enums import GameType

MOVES = ("가위", "바위", "보")
IDX = {m: i for i, m in enumerate(MOVES)}
RPSRESULT = {
    0: ("비김",  discord.Color.light_gray(), 0),
    1: ("승리",  discord.Color.blue(),       100),
    2: ("패배",  discord.Color.red(),        -100),
}


class GameSelectView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.add_item(GameSelect(cog))


class GameSelect(discord.ui.Select):
    def __init__(self, cog: "Game"):
        self.cog = cog
        options = [
            discord.SelectOption(label="참참참", value="cham"),
            discord.SelectOption(label="가위바위보", value="rps"),
        ]
        super().__init__(placeholder="게임선택", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "cham":
            await self.cog.start_cham(interaction)
        else:
            await self.cog.start_rps(interaction)


class ChamChamChamView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="왼쪽", style=discord.ButtonStyle.success)
    async def left(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_cham(interaction, "왼")

    @discord.ui.button(label="오른쪽", style=discord.ButtonStyle.success)
    async def right(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_cham(interaction, "오")


class RPSView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="가위", style=discord.ButtonStyle.success)
    async def scissors(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_rps(interaction, "가위")

    @discord.ui.button(label="바위", style=discord.ButtonStyle.success)
    async def rock(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_rps(interaction, "바위")

    @discord.ui.button(label="보", style=discord.ButtonStyle.success)
    async def paper(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_rps(interaction, "보")


class ChamResultView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="다시하기", style=discord.ButtonStyle.primary)
    async def retry(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.start_cham(interaction)


class RPSResultView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="다시하기", style=discord.ButtonStyle.primary)
    async def retry(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.start_rps(interaction)


async def _require_user(interaction: discord.Interaction, session) -> object | None:
    user = await get_user(session, interaction.user.id)
    if user is None:
        await interaction.response.edit_message(
            content="`!등록` 명령어로 먼저 등록해주세요.",
            embed=None,
            view=None,
        )
    return user


class Game(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="game", aliases=["게임"])
    async def game(self, ctx: commands.Context):
        await ctx.send("게임을 선택하세요", view=GameSelectView(self))

    async def start_cham(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="참참참",
            description=f"{interaction.user.mention}\n왼쪽/오른쪽 중 하나를 고르세요",
            color=discord.Color.brand_green(),
        )
        await interaction.response.send_message(embed=embed, view=ChamChamChamView(self))

    async def start_rps(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="가위바위보",
            description=f"{interaction.user.mention}\n가위/바위/보 중 하나를 고르세요",
            color=discord.Color.brand_green(),
        )
        await interaction.response.send_message(embed=embed, view=RPSView(self))

    async def play_cham(self, interaction: discord.Interaction, user_pick: str):
        async with SessionLocal() as session:
            user = await _require_user(interaction, session)
            if user is None:
                return

            bot_pick = random.choice(["왼", "오"])
            if user_pick == bot_pick:
                result, color, delta = "패배", discord.Color.red(), -100
            else:
                result, color, delta = "승리", discord.Color.blue(), 100

            await create_game_log(session, user, GameType.chamchamcham, result, delta)
            new_point = user.point  # _apply_point 반영 후 값

        point_str = f"+{delta}P" if delta > 0 else f"{delta}P"
        embed = discord.Embed(
            title="참참참 결과",
            color=color,
        )
        embed.add_field(name="선택", value=f"{interaction.user.display_name}: **{user_pick}** | 봇: **{bot_pick}**", inline=False)
        embed.add_field(name="결과", value=f"**{result}**", inline=True)
        embed.add_field(name="포인트", value=f"{point_str} → **{new_point:,}P**", inline=True)
        await interaction.response.edit_message(embed=embed, view=ChamResultView(self), attachments=[])

    async def play_rps(self, interaction: discord.Interaction, user_pick: str):
        async with SessionLocal() as session:
            user = await _require_user(interaction, session)
            if user is None:
                return

            bot_pick = random.choice(MOVES)
            u, b = IDX[user_pick], IDX[bot_pick]
            result, color, delta = RPSRESULT[(u - b) % 3]

            await create_game_log(session, user, GameType.rsp, result, delta)
            new_point = user.point

        point_str = f"+{delta}P" if delta > 0 else (f"{delta}P" if delta < 0 else "±0P")
        embed = discord.Embed(
            title="가위바위보 결과",
            color=color,
        )
        embed.add_field(name="선택", value=f"{interaction.user.display_name}: **{user_pick}** | 봇: **{bot_pick}**", inline=False)
        embed.add_field(name="결과", value=f"**{result}**", inline=True)
        embed.add_field(name="포인트", value=f"{point_str} → **{new_point:,}P**", inline=True)
        await interaction.response.edit_message(embed=embed, view=RPSResultView(self), attachments=[])


async def setup(bot: commands.Bot):
    await bot.add_cog(Game(bot))
