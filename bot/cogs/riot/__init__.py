import discord
from discord.ext import commands

from bot.cogs.control import category_embed
from bot.cogs.command_menu import CommandMenuView, MenuItem
from bot.cogs.riot.views import (
    RiotMenuView, make_favorite_manage_view,
    do_fetch_profile, do_fetch_history, do_fetch_stats, do_fetch_game_analysis,
)


class RiotCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.group(name="롤", invoke_without_command=True)
    async def lol(self, ctx: commands.Context):
        async def open_feature(interaction, callback, *, favorites=False):
            kwargs = dict(search_label="➕ 추가", favorites_label="📋 목록", favorites_view=make_favorite_manage_view) if favorites else {}
            await interaction.response.edit_message(
                content="소환사 검색 또는 즐겨찾기를 선택하세요.", embed=None,
                view=RiotMenuView(self, callback, **kwargs),
            )
        items = [
            MenuItem("프로필", "profile", lambda i: open_feature(i, do_fetch_profile), "랭크·마스터리 요약", "👤"),
            MenuItem("최근 전적", "history", lambda i: open_feature(i, do_fetch_history), "최근 게임 상세", "📜"),
            MenuItem("전적 분석", "stats", lambda i: open_feature(i, do_fetch_stats), "포지션 보정 분석", "📊"),
            MenuItem("게임 분석", "analysis", lambda i: open_feature(i, do_fetch_game_analysis), "경기 하나 상세 분석", "🔎"),
            MenuItem("즐겨찾기", "favorites", lambda i: open_feature(i, do_fetch_profile, favorites=True), "목록·추가·삭제", "⭐"),
        ]
        view = CommandMenuView(ctx.author.id, items, placeholder="롤 메뉴를 선택하세요")
        view.message = await ctx.reply(embed=category_embed("riot", ctx.clean_prefix), view=view, mention_author=False)

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
                favorites_view=make_favorite_manage_view,
            ),
            mention_author=False,
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(RiotCog(bot))
