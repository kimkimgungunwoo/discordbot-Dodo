from __future__ import annotations
import discord
from typing import TYPE_CHECKING, Callable, Awaitable

if TYPE_CHECKING:
    from bot.cogs.riot import RiotCog
    from api.models.riot_favorite import RiotFavorite

import discord
from api.database import SessionLocal
from api.crud.riot_crud import get_favorites, get_favorite, add_favorite, remove_favorite
from api.services.riot_api import fetch_profile, fetch_match_history, fetch_match_detail, RiotAPIError
from api.services.riot_stats import analyze_matches
from bot.cogs.riot.renderer import (
    render_profile_card, render_match_card, render_stats_card, render_game_analysis_card,
)


InteractionCallback = Callable[["RiotCog", discord.Interaction, str, str], Awaitable[None]]


async def _is_favorite(user_id: int, puuid: str) -> bool:
    async with SessionLocal() as session:
        return await get_favorite(session, user_id, puuid) is not None


async def do_fetch_profile(
    cog: "RiotCog",
    interaction: discord.Interaction,
    game_name: str,
    tag_line: str,
):
    try:
        profile = await fetch_profile(game_name, tag_line)
    except RiotAPIError as e:
        await interaction.followup.send(f"❌ {e}", ephemeral=True)
        return
    except Exception as e:
        await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
        return
    img  = await render_profile_card(profile)
    is_fav = await _is_favorite(interaction.user.id, profile.puuid)
    view = ProfileView(cog, profile.puuid, profile.game_name, profile.tag_line, is_fav)
    await interaction.followup.send(
        file=discord.File(img, "profile.png"), view=view
    )


async def do_fetch_history(
    cog: "RiotCog",
    interaction: discord.Interaction,
    game_name: str,
    tag_line: str,
):
    try:
        profile = await fetch_profile(game_name, tag_line)
    except RiotAPIError as e:
        await interaction.followup.send(f"❌ {e}", ephemeral=True)
        return
    except Exception as e:
        await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
        return

    view = QueueSelectView(cog, profile.puuid, profile.game_name, profile.tag_line)
    await interaction.followup.send(
        f"**{profile.game_name}#{profile.tag_line}** — 어떤 큐의 전적을 볼까요?",
        view=view,
    )


async def do_fetch_stats(
    cog: RiotCog,
    interaction: discord.Interaction,
    game_name: str,
    tag_line: str,
):
    try:
        profile = await fetch_profile(game_name, tag_line)
    except RiotAPIError as e:
        await interaction.followup.send(f"❌ {e}", ephemeral=True)
        return
    except Exception as e:
        await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
        return

    view = StatsQueueSelectView(cog, profile.puuid, profile.game_name, profile.tag_line)
    await interaction.followup.send(
        f"**{profile.game_name}#{profile.tag_line}** — 어떤 큐를 분석할까요?",
        view=view,
    )


class SearchModal(discord.ui.Modal, title="소환사 검색"):
    game_name = discord.ui.TextInput(
        label="닉네임",
        placeholder="예: Hide on bush",
        min_length=1, max_length=64,
    )
    tag_line = discord.ui.TextInput(
        label="태그",
        placeholder="예: KR1  (# 없이 입력)",
        min_length=1, max_length=16,
    )

    def __init__(self, cog: RiotCog, callback: InteractionCallback):
        super().__init__()
        self.cog       = cog
        self._callback = callback

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        await self._callback(
            self.cog, interaction,
            self.game_name.value.strip(),
            self.tag_line.value.strip(),
        )


class RiotMenuView(discord.ui.View):
    def __init__(
        self,
        cog: RiotCog,
        callback: InteractionCallback,
        *,
        search_label: str = "🔍 검색",
        favorites_label: str = "⭐ 즐겨찾기",
        favorites_view: type[discord.ui.View] | None = None,
    ):
        super().__init__(timeout=60)
        self.cog       = cog
        self._callback = callback
        self._favorites_view = favorites_view or FavoritesView
        self.search.label    = search_label
        self.favorites.label = favorites_label

    @discord.ui.button(label="🔍 검색", style=discord.ButtonStyle.primary)
    async def search(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_modal(SearchModal(self.cog, self._callback))

    @discord.ui.button(label="⭐ 즐겨찾기", style=discord.ButtonStyle.secondary)
    async def favorites(self, interaction: discord.Interaction, _button: discord.ui.Button):
        async with SessionLocal() as session:
            favs = await get_favorites(session, interaction.user.id)
        if not favs:
            await interaction.response.send_message(
                "즐겨찾기한 계정이 없습니다. 검색 후 ⭐ 버튼으로 등록할 수 있습니다.",
                ephemeral=True,
            )
            return
        await interaction.response.edit_message(
            content="즐겨찾기 계정을 선택하세요:",
            embeds=[],
            view=self._favorites_view(self.cog, favs, self._callback),
        )


class ProfileView(discord.ui.View):
    def __init__(self, cog: RiotCog, puuid: str, game_name: str, tag_line: str, is_favorite: bool):
        super().__init__(timeout=300)
        self.cog       = cog
        self.puuid     = puuid
        self.game_name = game_name
        self.tag_line  = tag_line
        self.remove_item(self.add_fav if is_favorite else self.remove_fav)

    @discord.ui.button(label="⭐ 즐겨찾기 등록", style=discord.ButtonStyle.success)
    async def add_fav(self, interaction: discord.Interaction, _button: discord.ui.Button):
        async with SessionLocal() as session:
            if await get_favorite(session, interaction.user.id, self.puuid):
                await interaction.response.send_message("이미 즐겨찾기에 등록된 계정입니다.", ephemeral=True)
                return
            await add_favorite(session, interaction.user.id, self.puuid, self.game_name, self.tag_line)
        await interaction.response.send_message(
            f"**{self.game_name}#{self.tag_line}** 을(를) 즐겨찾기에 추가했습니다.", ephemeral=True
        )

    @discord.ui.button(label="🗑️ 즐겨찾기 제외", style=discord.ButtonStyle.danger)
    async def remove_fav(self, interaction: discord.Interaction, _button: discord.ui.Button):
        async with SessionLocal() as session:
            removed = await remove_favorite(session, interaction.user.id, self.puuid)
        if not removed:
            await interaction.response.send_message("즐겨찾기에 등록되지 않은 계정입니다.", ephemeral=True)
            return
        await interaction.response.send_message(
            f"**{self.game_name}#{self.tag_line}** 을(를) 즐겨찾기에서 제거했습니다.", ephemeral=True
        )


class FavoritesSelect(discord.ui.Select):
    def __init__(self, cog: RiotCog, favorites: list, callback: InteractionCallback):
        self.cog       = cog
        self._callback = callback
        self._by_value = {f"{fav.game_name}#{fav.tag_line}": fav for fav in favorites}
        options = [
            discord.SelectOption(label=value, value=value)
            for value in self._by_value
        ][:25]
        super().__init__(placeholder="즐겨찾기한 계정 선택", options=options)

    async def callback(self, interaction: discord.Interaction):
        fav = self._by_value[self.values[0]]
        await interaction.response.defer()
        await self._callback(self.cog, interaction, fav.game_name, fav.tag_line)


class FavoritesView(discord.ui.View):
    def __init__(self, cog: RiotCog, favorites: list, callback: InteractionCallback):
        super().__init__(timeout=120)
        self.add_item(FavoritesSelect(cog, favorites, callback))


class FavoriteDeleteView(discord.ui.View):
    def __init__(self, fav: RiotFavorite):
        super().__init__(timeout=120)
        self.fav = fav

    @discord.ui.button(label="🗑️ 즐겨찾기 삭제", style=discord.ButtonStyle.danger)
    async def delete(self, interaction: discord.Interaction, _button: discord.ui.Button):
        async with SessionLocal() as session:
            await remove_favorite(session, interaction.user.id, self.fav.puuid)
        await interaction.response.edit_message(
            content=f"**{self.fav.game_name}#{self.fav.tag_line}** 을(를) 즐겨찾기에서 삭제했습니다.",
            view=None,
        )


async def do_show_favorite(cog: RiotCog, interaction: discord.Interaction, fav: RiotFavorite):
    """즐겨찾기 관리용: 프로필을 우선 시도하되, 조회 실패(닉네임 변경 등)해도 삭제는 항상 가능하게 한다."""
    try:
        profile = await fetch_profile(fav.game_name, fav.tag_line)
    except Exception as e:
        await interaction.followup.send(
            f"❌ 프로필을 불러올 수 없습니다: {e}",
            view=FavoriteDeleteView(fav),
            ephemeral=True,
        )
        return
    img  = await render_profile_card(profile)
    view = ProfileView(cog, profile.puuid, profile.game_name, profile.tag_line, is_favorite=True)
    await interaction.followup.send(file=discord.File(img, "profile.png"), view=view)


class FavoriteManageSelect(discord.ui.Select):
    def __init__(self, cog: RiotCog, favorites: list):
        self.cog       = cog
        self._by_value = {f"{fav.game_name}#{fav.tag_line}": fav for fav in favorites}
        options = [
            discord.SelectOption(label=value, value=value)
            for value in self._by_value
        ][:25]
        super().__init__(placeholder="즐겨찾기한 계정 선택", options=options)

    async def callback(self, interaction: discord.Interaction):
        fav = self._by_value[self.values[0]]
        await interaction.response.defer()
        await do_show_favorite(self.cog, interaction, fav)


class FavoriteManageView(discord.ui.View):
    def __init__(self, cog: RiotCog, favorites: list, _callback: InteractionCallback | None = None):
        super().__init__(timeout=120)
        self.add_item(FavoriteManageSelect(cog, favorites))


class QueueSelectView(discord.ui.View):
    def __init__(self, cog: RiotCog, puuid: str, game_name: str, tag_line: str):
        super().__init__(timeout=120)
        self.cog       = cog
        self.puuid     = puuid
        self.game_name = game_name
        self.tag_line  = tag_line

    async def _send_history(
        self,
        interaction: discord.Interaction,
        queue_id: int,
        queue_label: str,
    ):
        await interaction.response.defer()
        try:
            matches = await fetch_match_history(self.puuid, queue_id)
        except RiotAPIError as e:
            await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return
        except Exception as e:
            await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
            return

        img = await render_match_card(matches, self.game_name, self.tag_line, queue_label)
        await interaction.followup.send(file=discord.File(img, "matches.png"))

    @discord.ui.button(label="🏆 솔로랭크", style=discord.ButtonStyle.primary)
    async def solo(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._send_history(interaction, 420, "솔로랭크")

    @discord.ui.button(label="🏅 자유랭크", style=discord.ButtonStyle.secondary)
    async def flex(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._send_history(interaction, 440, "자유랭크")


class StatsQueueSelectView(discord.ui.View):
    def __init__(self, cog: RiotCog, puuid: str, game_name: str, tag_line: str):
        super().__init__(timeout=120)
        self.cog       = cog
        self.puuid     = puuid
        self.game_name = game_name
        self.tag_line  = tag_line

    async def _send_stats(
        self,
        interaction: discord.Interaction,
        queue_id: int,
        queue_label: str,
    ):
        await interaction.response.defer()
        try:
            matches = await fetch_match_history(self.puuid, queue_id, count=20)
        except RiotAPIError as e:
            await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return
        except Exception as e:
            await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
            return

        stats = analyze_matches(matches)
        if stats is None:
            await interaction.followup.send("최근 게임 기록이 없습니다.", ephemeral=True)
            return

        img = await render_stats_card(stats, self.game_name, self.tag_line, queue_label, matches=matches)
        await interaction.followup.send(file=discord.File(img, "stats.png"))

    @discord.ui.button(label="🏆 솔로랭크", style=discord.ButtonStyle.primary)
    async def solo(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._send_stats(interaction, 420, "솔로랭크")

    @discord.ui.button(label="🏅 자유랭크", style=discord.ButtonStyle.secondary)
    async def flex(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._send_stats(interaction, 440, "자유랭크")


async def do_fetch_game_analysis(
    cog: "RiotCog",
    interaction: discord.Interaction,
    game_name: str,
    tag_line: str,
):
    try:
        profile = await fetch_profile(game_name, tag_line)
    except RiotAPIError as e:
        await interaction.followup.send(f"❌ {e}", ephemeral=True)
        return
    except Exception as e:
        await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
        return

    view = GameAnalysisQueueSelectView(cog, profile.puuid, profile.game_name, profile.tag_line)
    await interaction.followup.send(
        f"**{profile.game_name}#{profile.tag_line}** — 어떤 큐를 분석할까요?",
        view=view,
    )


class GameAnalysisQueueSelectView(discord.ui.View):
    def __init__(self, cog: RiotCog, puuid: str, game_name: str, tag_line: str):
        super().__init__(timeout=120)
        self.cog       = cog
        self.puuid     = puuid
        self.game_name = game_name
        self.tag_line  = tag_line

    async def _pick_queue(self, interaction: discord.Interaction, queue_id: int, queue_label: str):
        await interaction.response.defer()
        try:
            matches = await fetch_match_history(self.puuid, queue_id, count=10)
        except RiotAPIError as e:
            await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return
        except Exception as e:
            await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
            return
        if not matches:
            await interaction.followup.send("최근 게임 기록이 없습니다.", ephemeral=True)
            return

        await interaction.followup.send(
            f"**{self.game_name}#{self.tag_line}** — 상세분석할 게임을 선택하세요:",
            view=MatchPickView(self.cog, matches, self.puuid, self.game_name, self.tag_line, queue_label),
        )

    @discord.ui.button(label="🏆 솔로랭크", style=discord.ButtonStyle.primary)
    async def solo(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._pick_queue(interaction, 420, "솔로랭크")

    @discord.ui.button(label="🏅 자유랭크", style=discord.ButtonStyle.secondary)
    async def flex(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._pick_queue(interaction, 440, "자유랭크")


class MatchPickSelect(discord.ui.Select):
    def __init__(
        self, cog: RiotCog, matches: list, puuid: str,
        game_name: str, tag_line: str, queue_label: str,
    ):
        self.cog        = cog
        self.puuid      = puuid
        self.game_name  = game_name
        self.tag_line   = tag_line
        self.queue_label = queue_label
        options = [
            discord.SelectOption(
                label=f"{'승' if m.win else '패'} · {m.champion_name} · {m.kills}/{m.deaths}/{m.assists}",
                description=f"{m.grade} · {m.score}점 · {m.duration_str}",
                value=m.match_id,
            )
            for m in matches[:25]
        ]
        super().__init__(placeholder="상세분석할 게임을 선택하세요", options=options)

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer()
        try:
            detail = await fetch_match_detail(self.values[0], self.puuid)
        except RiotAPIError as e:
            await interaction.followup.send(f"❌ {e}", ephemeral=True)
            return
        except Exception as e:
            await interaction.followup.send(f"❌ 오류: {e}", ephemeral=True)
            return

        img = await render_game_analysis_card(detail, self.game_name, self.tag_line, self.queue_label)
        await interaction.followup.send(file=discord.File(img, "analysis.png"))


class MatchPickView(discord.ui.View):
    def __init__(
        self, cog: RiotCog, matches: list, puuid: str,
        game_name: str, tag_line: str, queue_label: str,
    ):
        super().__init__(timeout=120)
        self.add_item(MatchPickSelect(cog, matches, puuid, game_name, tag_line, queue_label))
