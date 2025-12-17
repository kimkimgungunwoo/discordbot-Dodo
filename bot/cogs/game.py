import discord
from discord.ext import commands
import random

#가위바위보 최적화
MOVES=("가위","바위","보")
IDX={m:i for i, m in enumerate(MOVES)}
RPSRESULT={0:("비김",discord.Color.light_gray()),1:("승리",discord.Color.blue()),2:("패",discord.Color.red())}

class GameView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.add_item(GameSelect(cog))


class GameSelect(discord.ui.Select):
    def __init__(self, cog: "Game"):
        self.cog = cog
        options = [discord.SelectOption(label="참참참", value="cham"),
                   discord.SelectOption(label="가위바위보",value="rps")]
        super().__init__(placeholder="게임선택", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "cham":
            await self.cog.start_cham(interaction)
        if self.values[0] == "rps":
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
    def __init__(self,cog:"Game"):
        super().__init__(timeout=None)
        self.cog=cog
    
    @discord.ui.button(label="가위",style=discord.ButtonStyle.success)
    async def scissors(self,interaction:discord.Interaction,button:discord.ui.Button):
        await self.cog.play_rps(interaction,"가위")
    
    @discord.ui.button(label="바위",style=discord.ButtonStyle.success)
    async def rock(self,interaction:discord.Interaction,button:discord.ui.Button):
        await self.cog.play_rps(interaction,"바위")

    @discord.ui.button(label="보",style=discord.ButtonStyle.success)
    async def paper(self,interaction:discord.Interaction,button:discord.ui.Button):
        await self.cog.play_rps(interaction,"보")


class ChamChamChamResultView(discord.ui.View):
    def __init__(self, cog: "Game"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="다시하기", style=discord.ButtonStyle.primary)
    async def retryCham(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.start_cham(interaction)

class RPSResultView(discord.ui.View):
    def __init__(self,cog:"Game"):
        super().__init__(timeout=None)
        self.cog=cog
    
    @discord.ui.button(label="다시하기", style=discord.ButtonStyle.primary)
    async def retryRps(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.start_rps(interaction)
    

class Game(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="game", aliases=["게임"])
    async def game(self, ctx: commands.Context):
        await ctx.send("게임을 선택하세요", view=GameView(self))

    async def start_cham(self, interaction: discord.Interaction):
        player = interaction.user
        embed = discord.Embed(
            title="참참참",
            description=f"{player.mention}\n왼쪽/오른쪽 중 하나를 고르세요",
            color=discord.Color.brand_green()
        )
        await interaction.response.send_message(embed=embed, view=ChamChamChamView(self))

    async def start_rps(self,interaction:discord.Interaction):
        player = interaction.user
        embed=discord.Embed(
            title="가위바위보",
            description="가위바위보중 하나를 고르세요",
            color=discord.Color.brand_green()
        )
        await interaction.response.send_message(embed=embed,view=RPSView(self))


    async def play_cham(self, interaction: discord.Interaction, user_pick: str):
        player = interaction.user
        bot_pick = random.choice(["왼", "오"])
        if user_pick == bot_pick:
            res = "패배"
            color = discord.Color.red()
        else:
            res = "승리"
            color = discord.Color.blue()

        embed = discord.Embed(
            title="참참참 결과",
            description=f"{player.mention}\n너: {user_pick}\n봇: {bot_pick}\n결과: {res}",
            color=color
        )
        await interaction.response.send_message(embed=embed, view=ChamChamChamResultView(self))

    async def play_rps(self,interaction:discord.Interaction,user_pick : str):
        player=interaction.user
        bot_pick=random.choice(MOVES)
        u=IDX[user_pick]
        b=IDX[bot_pick]

        outcome=RPSRESULT[(u-b)%3]

        embed=discord.Embed(
            title="가위바위보 결과",
            description=f"{player.mention} \n 너 : {user_pick} \n 봇 : {bot_pick} \n 결과 : {outcome[0]}",
            color=outcome[1]
        )

        await interaction.response.send_message(embed=embed,view=RPSResultView(self))

        
    

async def setup(bot: commands.Bot):
    await bot.add_cog(Game(bot))
