import discord
from discord.ext import commands

from bot.cogs.control import category_embed
from bot.cogs.command_menu import CommandMenuView, MenuItem
from bot.cogs.overwatch.views import (
    OverwatchMenuView, do_fetch_profile, do_fetch_analysis, do_hero_analysis_menu,
)


class Overwatch(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.group(name="오버워치", invoke_without_command=True)
    async def overwatch_group(self, ctx: commands.Context):
        async def open_feature(interaction, callback, *, favorites=False):
            kwargs = dict(search_label="➕ 추가", favorites_label="📋 목록") if favorites else {}
            await interaction.response.edit_message(
                content="계정 검색 또는 즐겨찾기를 선택하세요.", embed=None,
                view=OverwatchMenuView(callback, **kwargs),
            )
        items = [
            MenuItem("프로필", "profile", lambda i: open_feature(i, do_fetch_profile), emoji="👤"),
            MenuItem("종합 분석", "analysis", lambda i: open_feature(i, do_fetch_analysis), emoji="📊"),
            MenuItem("영웅 분석", "hero", lambda i: open_feature(i, do_hero_analysis_menu), emoji="🦸"),
            MenuItem("즐겨찾기", "favorites", lambda i: open_feature(i, do_fetch_profile, favorites=True), emoji="⭐"),
        ]
        view = CommandMenuView(ctx.author.id, items, placeholder="오버워치 메뉴를 선택하세요")
        view.message = await ctx.reply(embed=category_embed("overwatch", ctx.clean_prefix), view=view, mention_author=False)

    @overwatch_group.command(name="프로필")
    async def profile(self, ctx: commands.Context):
        view = OverwatchMenuView(do_fetch_profile)
        view.message = await ctx.reply("원하는 방식을 선택하세요:", view=view, mention_author=False)

    @overwatch_group.command(name="즐겨찾기")
    async def favorites(self, ctx: commands.Context):
        view = OverwatchMenuView(do_fetch_profile, search_label="➕ 추가", favorites_label="📋 목록")
        view.message = await ctx.reply("원하는 방식을 선택하세요:", view=view, mention_author=False)

    @overwatch_group.command(name="분석")
    async def analysis(self, ctx: commands.Context):
        view = OverwatchMenuView(do_fetch_analysis)
        view.message = await ctx.reply("원하는 방식을 선택하세요:", view=view, mention_author=False)

    @overwatch_group.command(name="영웅분석")
    async def hero_analysis(self, ctx: commands.Context):
        view = OverwatchMenuView(do_hero_analysis_menu)
        view.message = await ctx.reply("원하는 방식을 선택하세요:", view=view, mention_author=False)


async def setup(bot: commands.Bot):
    await bot.add_cog(Overwatch(bot))
