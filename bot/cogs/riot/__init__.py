import discord
from discord.ext import commands

from bot.cogs.control import category_embed
from bot.cogs.riot.views import (
    RiotMenuView, FavoriteManageView,
    do_fetch_profile, do_fetch_history, do_fetch_stats, do_fetch_game_analysis,
)


class RiotCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.group(name="롤", invoke_without_command=True)
    async def lol(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("riot"), mention_author=False)

    @lol.command(name="프로필")
    async def lol_profile(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(self, do_fetch_profile),
            mention_author=False,
        )

    @lol.command(name="전적")
    async def lol_history(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(self, do_fetch_history),
            mention_author=False,
        )

    @lol.command(name="전적분석")
    async def lol_stats(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(self, do_fetch_stats),
            mention_author=False,
        )

    @lol.command(name="게임분석")
    async def lol_game_analysis(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(self, do_fetch_game_analysis),
            mention_author=False,
        )

    @lol.command(name="즐겨찾기")
    async def lol_favorites(self, ctx: commands.Context):
        await ctx.reply(
            "원하는 방식을 선택하세요:",
            view=RiotMenuView(
                self, do_fetch_profile,
                search_label="➕ 추가", favorites_label="📋 목록",
                favorites_view=FavoriteManageView,
            ),
            mention_author=False,
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(RiotCog(bot))
