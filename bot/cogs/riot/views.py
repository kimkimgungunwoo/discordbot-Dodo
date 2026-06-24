from __future__ import annotations
import discord
from typing import TYPE_CHECKING, Callable, Awaitable

if TYPE_CHECKING:
    from bot.cogs.riot import RiotCog

from api.database import SessionLocal
from api.crud.riot_crud import get_favorites, get_favorite, add_favorite, remove_favorite
from api.services.riot_api import fetch_profile, fetch_match_history, RiotAPIError
from bot.cogs.riot.embeds import build_profile_embeds, build_match_embeds

InteractionCallback = Callable[["RiotCog", discord.Interaction, str, str], Awaitable[None]]


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
    embeds = build_profile_embeds(profile)
    view   = ProfileView(cog, profile.puuid, profile.game_name, profile.tag_line)
    await interaction.followup.send(embeds=embeds, view=view)


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

    embed = discord.Embed(
        title=f"🎮 {profile.game_name}#{profile.tag_line}",
        description="어떤 큐의 전적을 볼까요?",
        color=0x5865F2,
    )
    view = QueueSelectView(cog, profile.puuid, profile.game_name, profile.tag_line)
    await interaction.followup.send(embed=embed, view=view)


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
    def __init__(self, cog: RiotCog, callback: InteractionCallback):
        super().__init__(timeout=60)
        self.cog       = cog
        self._callback = callback

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
            view=FavoritesView(self.cog, favs, self._callback),
        )


class ProfileView(discord.ui.View):
    def __init__(self, cog: RiotCog, puuid: str, game_name: str, tag_line: str):
        super().__init__(timeout=300)
        self.cog       = cog
        self.puuid     = puuid
        self.game_name = game_name
        self.tag_line  = tag_line

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
        options = [
            discord.SelectOption(
                label=f"{fav.game_name}#{fav.tag_line}",
                value=f"{fav.game_name}#{fav.tag_line}",
            )
            for fav in favorites[:25]
        ]
        super().__init__(placeholder="즐겨찾기한 계정 선택", options=options)

    async def callback(self, interaction: discord.Interaction):
        game_name, tag_line = self.values[0].rsplit("#", 1)
        await interaction.response.defer()
        await self._callback(self.cog, interaction, game_name, tag_line)


class FavoritesView(discord.ui.View):
    def __init__(self, cog: RiotCog, favorites: list, callback: InteractionCallback):
        super().__init__(timeout=120)
        self.add_item(FavoritesSelect(cog, favorites, callback))


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

        embeds = build_match_embeds(matches, self.game_name, self.tag_line, queue_label)
        header = discord.Embed(
            title=f"📜 {self.game_name}#{self.tag_line}  —  {queue_label} 최근 {len(matches)}게임",
            color=0x5865F2,
        )
        await interaction.followup.send(embeds=[header] + embeds[:9])
        if len(embeds) > 9:
            await interaction.followup.send(embeds=embeds[9:])

    @discord.ui.button(label="🏆 솔로랭크", style=discord.ButtonStyle.primary)
    async def solo(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._send_history(interaction, 420, "솔로랭크")

    @discord.ui.button(label="🏅 자유랭크", style=discord.ButtonStyle.secondary)
    async def flex(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._send_history(interaction, 440, "자유랭크")
