"""`!음악 즐겨찾기` — 유저별(서버 무관) 유튜브 곡 즐겨찾기 목록. 롤 즐겨찾기(bot/cogs/riot/views.py)와 같은 흐름."""
from __future__ import annotations
import random
import discord
from typing import TYPE_CHECKING

from api.database import SessionLocal
from api.crud.music_crud import get_favorites, remove_favorite
from api.models.music_favorite import MusicFavorite
from bot.cogs.paginated_select import PaginatedSelectView
from bot.cogs.music.views import SavedPlayable, Track, FavoriteButtonView, enqueued_text, format_duration

if TYPE_CHECKING:
    from bot.cogs.music import Music

NO_VOICE_MSG = "`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요."


def _track(fav: MusicFavorite, requester: discord.Member) -> Track:
    return Track(SavedPlayable(fav.video_id, fav.title, fav.author, fav.length_ms, fav.uri), requester)


async def _not_owner(interaction: discord.Interaction, owner_id: int) -> bool:
    if interaction.user.id == owner_id:
        return False
    await interaction.response.send_message("본인의 `!음악 즐겨찾기`에서만 조작할 수 있습니다.", ephemeral=True)
    return True


class FavoriteActionView(discord.ui.View):
    """목록에서 고른 곡 하나에 대한 재생/삭제."""
    def __init__(self, cog: "Music", fav: MusicFavorite):
        super().__init__(timeout=120)
        self.cog, self.fav = cog, fav

    @discord.ui.button(label="▶️ 대기열에 추가", style=discord.ButtonStyle.primary)
    async def play(self, interaction: discord.Interaction, _button: discord.ui.Button):
        if interaction.guild.voice_client is None:
            await interaction.response.send_message(NO_VOICE_MSG, ephemeral=True)
            return
        await interaction.response.edit_message(content=f"⏳ **{self.fav.title}** 준비 중...", view=None)
        track = _track(self.fav, interaction.user)
        pos = await self.cog.enqueue(interaction.guild, [track])
        await interaction.channel.send(enqueued_text(track, pos), view=FavoriteButtonView(track))
        await interaction.delete_original_response()

    @discord.ui.button(label="🗑️ 즐겨찾기 삭제", style=discord.ButtonStyle.danger)
    async def delete(self, interaction: discord.Interaction, _button: discord.ui.Button):
        async with SessionLocal() as session:
            await remove_favorite(session, interaction.user.id, self.fav.video_id)
        await interaction.response.edit_message(content=f"🗑️ **{self.fav.title}** 을(를) 즐겨찾기에서 삭제했습니다.", view=None)


def make_favorites_view(cog: "Music", owner: discord.Member, favorites: list[MusicFavorite]) -> discord.ui.View:
    by_value = {fav.video_id: fav for fav in favorites}
    options = [
        discord.SelectOption(label=fav.title[:100], description=f"{fav.author} • {format_duration(fav.length_ms // 1000)}"[:100], value=fav.video_id)
        for fav in favorites
    ]

    async def on_pick(interaction: discord.Interaction, value: str):
        if await _not_owner(interaction, owner.id):
            return
        fav = by_value[value]
        await interaction.response.send_message(f"🎵 **{fav.title}**", view=FavoriteActionView(cog, fav), ephemeral=True)

    view = PaginatedSelectView(options, on_pick, placeholder="즐겨찾기한 곡 선택")

    shuffle_all = discord.ui.Button(label=f"🔀 전체 재생 ({len(favorites)}곡)", style=discord.ButtonStyle.success, row=2)

    async def on_shuffle(interaction: discord.Interaction):
        if await _not_owner(interaction, owner.id):
            return
        if interaction.guild.voice_client is None:
            await interaction.response.send_message(NO_VOICE_MSG, ephemeral=True)
            return
        await interaction.response.defer()
        tracks = [_track(fav, interaction.user) for fav in random.sample(favorites, len(favorites))]
        pos = await cog.enqueue(interaction.guild, tracks)
        where = "지금 재생을 시작합니다" if pos is None else f"대기열 {pos}번부터 추가했습니다"
        await interaction.followup.send(f"🔀 {owner.display_name}님의 즐겨찾기 {len(tracks)}곡을 섞어서 {where}.")

    shuffle_all.callback = on_shuffle
    view.add_item(shuffle_all)
    return view


async def show_favorites(cog: "Music", ctx) -> None:
    async with SessionLocal() as session:
        favorites = await get_favorites(session, ctx.author.id)
    if not favorites:
        await ctx.reply("⭐ 즐겨찾기한 곡이 없습니다. 재생 안내 메시지의 **⭐ 즐겨찾기** 버튼으로 담아보세요.", mention_author=False)
        return
    await ctx.reply(
        f"⭐ **{ctx.author.display_name}**님의 음악 즐겨찾기 ({len(favorites)}곡)",
        view=make_favorites_view(cog, ctx.author, favorites),
        mention_author=False,
    )
