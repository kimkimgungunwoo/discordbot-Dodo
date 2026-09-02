from __future__ import annotations
import discord
from typing import Callable, Awaitable

from api.database import SessionLocal
from api.crud.overwatch_crud import get_favorites, get_favorite, add_favorite, remove_favorite
from api.services.overwatch_api import (
    search_players, fetch_profile, fetch_hero_analysis, fetch_all_heroes, fetch_hero_detail,
    OverwatchAPIError,
)
from bot.cogs.overwatch.renderer import (
    render_profile_card, render_analysis_card, render_hero_analysis_card, render_hero_detail_card,
)
from bot.cogs.overwatch.ai_comment import (
    generate_comment, build_analysis_prompt, build_hero_analysis_prompt, build_hero_detail_prompt,
)

InteractionCallback = Callable[[discord.Interaction, str], Awaitable[None]]

NOT_FOUND_MSG = "해당 BattleTag의 유저를 찾을 수 없습니다."
NO_STATS_MSG = "프로필이 비공개이거나 공개된 통계가 없습니다."
SERVER_ERROR_MSG = "현재 오버워치 프로필 서버 조회에 실패했습니다. 잠시 후 다시 시도해주세요."


async def _send_api_error(interaction: discord.Interaction, e: OverwatchAPIError):
    # 404만 "존재 자체가 없음"이고, 나머지(429 레이트리밋/5xx 등)는 OverFast·블리자드 쪽
    # 일시적 문제라 사용자에게 다른 안내를 준다.
    msg = NOT_FOUND_MSG if e.status == 404 else SERVER_ERROR_MSG
    await interaction.followup.send(f"❌ {msg}", ephemeral=True)


async def _send_unexpected_error(interaction: discord.Interaction, e: Exception):
    print(f"[Overwatch] 예상 못한 오류: {type(e).__name__}: {e}")
    await interaction.followup.send(f"❌ {SERVER_ERROR_MSG}", ephemeral=True)


class StaleView(discord.ui.View):
    """타임아웃되면 컴포넌트를 비활성화하고 안내 문구로 메시지를 바꾼다. 그냥 두면 나중에
    눌렀을 때 봇이 이 뷰를 메모리에서 이미 놔버린 상태라 3초 안에 응답을 못 해 디스코드가
    '적시에 응답하지 않았어요'를 띄운다 — 그 전에 먼저 죽여서 원인 모를 에러를 막는다."""

    def __init__(self, *, timeout: float = 300, timeout_message: str = "⏱️ 시간이 만료됐습니다. 다시 시도해주세요."):
        super().__init__(timeout=timeout)
        self.message: discord.Message | None = None
        self._timeout_message = timeout_message

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True
        if self.message:
            try:
                await self.message.edit(content=self._timeout_message, view=self)
            except discord.HTTPException:
                pass


async def _is_favorite(user_id: int, player_id: str) -> bool:
    async with SessionLocal() as session:
        return await get_favorite(session, user_id, player_id) is not None


async def _send_view(interaction: discord.Interaction, player_id: str, profile, img):
    is_fav = await _is_favorite(interaction.user.id, player_id)
    view = ProfileView(player_id, profile.name, profile.title, is_fav)
    view.message = await interaction.followup.send(file=discord.File(img, "profile.png"), view=view, wait=True)


async def do_fetch_profile(interaction: discord.Interaction, player_id: str):
    try:
        profile = await fetch_profile(player_id)
    except OverwatchAPIError as e:
        await _send_api_error(interaction, e)
        return
    except Exception as e:
        await _send_unexpected_error(interaction, e)
        return
    if profile.games_played == 0:
        await interaction.followup.send(f"❌ {NO_STATS_MSG}", ephemeral=True)
        return
    img = await render_profile_card(profile)
    await _send_view(interaction, player_id, profile, img)


async def do_fetch_analysis(interaction: discord.Interaction, player_id: str):
    try:
        profile = await fetch_profile(player_id)
    except OverwatchAPIError as e:
        await _send_api_error(interaction, e)
        return
    except Exception as e:
        await _send_unexpected_error(interaction, e)
        return
    if profile.games_played == 0:
        await interaction.followup.send(f"❌ {NO_STATS_MSG}", ephemeral=True)
        return
    comment = await generate_comment(build_analysis_prompt(profile, profile.name))
    img = await render_analysis_card(profile, ai_comment=comment)
    await _send_view(interaction, player_id, profile, img)


async def do_fetch_hero_analysis(interaction: discord.Interaction, player_id: str):
    try:
        hero_analysis = await fetch_hero_analysis(player_id)
    except OverwatchAPIError as e:
        await _send_api_error(interaction, e)
        return
    except Exception as e:
        await _send_unexpected_error(interaction, e)
        return
    if not hero_analysis.top_heroes:
        await interaction.followup.send(f"❌ {NO_STATS_MSG}", ephemeral=True)
        return
    comment = await generate_comment(build_hero_analysis_prompt(hero_analysis.top_heroes, hero_analysis.name))
    img = await render_hero_analysis_card(hero_analysis, ai_comment=comment)
    await interaction.followup.send(file=discord.File(img, "hero_analysis.png"))


async def do_hero_pick(interaction: discord.Interaction, player_id: str):
    try:
        hero_analysis = await fetch_all_heroes(player_id)
    except OverwatchAPIError as e:
        await _send_api_error(interaction, e)
        return
    except Exception as e:
        await _send_unexpected_error(interaction, e)
        return
    if not any(h.games_played for h in hero_analysis.top_heroes):
        await interaction.followup.send(f"❌ {NO_STATS_MSG}", ephemeral=True)
        return
    view = HeroPickView(player_id, hero_analysis.top_heroes)
    view.message = await interaction.followup.send(
        "상세분석할 영웅을 역할별로 선택하세요 (플레이시간 순):", view=view, wait=True,
    )


class HeroAnalysisModeView(StaleView):
    def __init__(self, player_id: str):
        super().__init__()
        self.player_id = player_id

    @discord.ui.button(label="📊 종합 분석", style=discord.ButtonStyle.primary)
    async def overall(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.defer()
        await do_fetch_hero_analysis(interaction, self.player_id)

    @discord.ui.button(label="🔍 단일 영웅", style=discord.ButtonStyle.secondary)
    async def single(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.defer()
        await do_hero_pick(interaction, self.player_id)


async def do_hero_analysis_menu(interaction: discord.Interaction, player_id: str):
    view = HeroAnalysisModeView(player_id)
    view.message = await interaction.followup.send(
        "🔎 분석 방식을 선택하세요:", view=view, wait=True,
    )


class BattletagModal(discord.ui.Modal, title="배틀태그 검색"):
    name = discord.ui.TextInput(
        label="닉네임",
        placeholder="예: Jjonak",
        min_length=1, max_length=32,
    )
    tag = discord.ui.TextInput(
        label="태그 (알면 입력, 모르면 비워두세요)",
        placeholder="예: 1234",
        required=False, max_length=8,
    )

    def __init__(self, callback: InteractionCallback):
        super().__init__()
        self._callback = callback

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        name = self.name.value.strip()
        tag = self.tag.value.strip().lstrip("#-")

        if tag:
            # 태그까지 정확히 알면 이름-태그 형식으로 그 계정 하나를 바로 조회한다 —
            # OverFast의 이름 검색(/players?name=)엔 태그 구분자가 아예 없어서 동명이인이면
            # 목록에서 골라야 하지만, 이 legacy 배틀태그 형식은 player_id로 그대로 써도
            # 정확히 그 계정 하나만 찾아준다 (실측 확인: 틀린 태그는 404로 정확히 거부됨).
            player_id = f"{name}-{tag}"
            try:
                await fetch_profile(player_id)  # 존재 확인용 (콜백이 다시 조회하지만 캐시돼서 비용 작음)
            except Exception:
                pass  # 정확 조회 실패 시 아래 이름 검색으로 폴백 (에러 메시지는 아직 안 보냄)
            else:
                await self._callback(interaction, player_id)
                return

        try:
            results = await search_players(name)
        except OverwatchAPIError as e:
            await _send_api_error(interaction, e)
            return
        except Exception as e:
            await _send_unexpected_error(interaction, e)
            return
        if not results:
            await interaction.followup.send(f"❌ {NOT_FOUND_MSG}", ephemeral=True)
            return
        view = PlayerPickView(results, self._callback)
        view.message = await interaction.followup.send(
            f"**{name}** 검색 결과 — 계정을 선택하세요:", view=view, wait=True,
        )


class OverwatchMenuView(StaleView):
    def __init__(
        self,
        callback: InteractionCallback,
        *,
        search_label: str = "🔍 검색",
        favorites_label: str = "⭐ 즐겨찾기",
    ):
        super().__init__()
        self._callback = callback
        self.search.label = search_label
        self.favorites.label = favorites_label

    @discord.ui.button(label="🔍 검색", style=discord.ButtonStyle.primary)
    async def search(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_modal(BattletagModal(self._callback))

    @discord.ui.button(label="⭐ 즐겨찾기", style=discord.ButtonStyle.secondary)
    async def favorites(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.defer()
        async with SessionLocal() as session:
            favs = await get_favorites(session, interaction.user.id)
        if not favs:
            await interaction.followup.send(
                "즐겨찾기한 계정이 없습니다. 검색 후 ⭐ 버튼으로 등록할 수 있습니다.", ephemeral=True,
            )
            return
        view = FavoriteManageView(favs, self._callback)
        view.message = await interaction.edit_original_response(
            content="즐겨찾기 계정을 선택하세요:", view=view,
        )


class PlayerPickSelect(discord.ui.Select):
    def __init__(self, results: list, callback: InteractionCallback):
        self._by_value = {r.player_id: r for r in results}
        self._callback = callback
        options = [
            discord.SelectOption(
                label=r.name, description=r.title or None, value=r.player_id,
            )
            for r in results
        ][:25]
        super().__init__(placeholder="계정을 선택하세요", options=options)

    async def callback(self, interaction: discord.Interaction):
        r = self._by_value[self.values[0]]
        await interaction.response.defer()
        await self._callback(interaction, r.player_id)


class PlayerPickView(StaleView):
    def __init__(self, results: list, callback: InteractionCallback):
        super().__init__()
        self.add_item(PlayerPickSelect(results, callback))


class ProfileView(StaleView):
    def __init__(self, player_id: str, name: str, title: str | None, is_favorite: bool):
        super().__init__()
        self.player_id = player_id
        self.name = name
        self.title = title
        self.remove_item(self.add_fav if is_favorite else self.remove_fav)

    @discord.ui.button(label="⭐ 즐겨찾기 등록", style=discord.ButtonStyle.success)
    async def add_fav(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        async with SessionLocal() as session:
            if await get_favorite(session, interaction.user.id, self.player_id):
                await interaction.followup.send("이미 즐겨찾기에 등록된 계정입니다.", ephemeral=True)
                return
            await add_favorite(session, interaction.user.id, self.player_id, self.name, self.title)
        await interaction.followup.send(f"**{self.name}** 을(를) 즐겨찾기에 추가했습니다.", ephemeral=True)

    @discord.ui.button(label="🗑️ 즐겨찾기 제외", style=discord.ButtonStyle.danger)
    async def remove_fav(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)
        async with SessionLocal() as session:
            removed = await remove_favorite(session, interaction.user.id, self.player_id)
        if not removed:
            await interaction.followup.send("즐겨찾기에 등록되지 않은 계정입니다.", ephemeral=True)
            return
        await interaction.followup.send(f"**{self.name}** 을(를) 즐겨찾기에서 제거했습니다.", ephemeral=True)


class FavoriteManageSelect(discord.ui.Select):
    def __init__(self, favorites: list, callback: InteractionCallback):
        self._by_value = {f.player_id: f for f in favorites}
        self._callback = callback
        options = [
            discord.SelectOption(label=f.name, description=f.title or None, value=f.player_id)
            for f in favorites
        ][:25]
        super().__init__(placeholder="즐겨찾기한 계정 선택", options=options)

    async def callback(self, interaction: discord.Interaction):
        fav = self._by_value[self.values[0]]
        await interaction.response.defer()
        await self._callback(interaction, fav.player_id)


class FavoriteManageView(StaleView):
    def __init__(self, favorites: list, callback: InteractionCallback):
        super().__init__()
        self.add_item(FavoriteManageSelect(favorites, callback))


_ROLE_LABEL = {"tank": "🛡️ 탱커", "damage": "⚔️ 딜러", "support": "💚 힐러"}


class HeroPickSelect(discord.ui.Select):
    def __init__(self, role: str, heroes: list):
        options = [
            discord.SelectOption(
                label=f"{i}. {h.name}",
                description=f"{h.hours_played}시간 · 승률 {h.winrate}%" if h.games_played else "플레이 기록 없음",
                value=h.key,
            )
            for i, h in enumerate(heroes, 1)
        ][:25]
        role_label = _ROLE_LABEL.get(role, role)
        super().__init__(placeholder=f"{role_label} 영웅 선택 (플레이시간 순)", options=options)

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        player_id: str = self.view.player_id
        try:
            hero_detail = await fetch_hero_detail(player_id, self.values[0])
        except OverwatchAPIError as e:
            await _send_api_error(interaction, e)
            return
        except Exception as e:
            await _send_unexpected_error(interaction, e)
            return
        if hero_detail.games_played == 0:
            await interaction.followup.send("해당 영웅 플레이 기록이 없습니다.", ephemeral=True)
            return
        comment = await generate_comment(build_hero_detail_prompt(hero_detail, hero_detail.player_name))
        img = await render_hero_detail_card(hero_detail, ai_comment=comment)
        await interaction.followup.send(file=discord.File(img, "hero_detail.png"), ephemeral=True)


class HeroPickView(StaleView):
    def __init__(self, player_id: str, heroes: list):
        super().__init__(timeout_message="⏱️ 선택 시간이 만료됐습니다. 다시 시도해주세요.")
        self.player_id = player_id
        by_role: dict[str, list] = {"tank": [], "damage": [], "support": []}
        for h in heroes:
            by_role.setdefault(h.role, []).append(h)
        for role in ("tank", "damage", "support"):
            if by_role.get(role):
                self.add_item(HeroPickSelect(role, by_role[role]))
