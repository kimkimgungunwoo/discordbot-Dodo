import discord
from discord.ext import commands

from bot.cogs.riot.views import RiotMenuView, do_fetch_profile, do_fetch_history


class RiotCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="롤프로필")
    async def lol_profile(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(self, do_fetch_profile),
            mention_author=False,
        )

    @commands.command(name="롤전적")
    async def lol_history(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(self, do_fetch_history),
            mention_author=False,
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(RiotCog(bot))
