from __future__ import annotations

import discord

from .registry import GAMES


FILTERS = {
    "rummikub:PVP": ("rummikub", "PVP", "🀄 루미큐브 · 포인트"),
    "rock_run:SOLO": ("rock_run", "SOLO", "🏜️ 바위달리기 · 일반"),
    "rock_run:ENDLESS": ("rock_run", "SOLO", "🏜️ 바위달리기 · 엔드리스"),
    "arrow_dodge:SOLO": ("arrow_dodge", "SOLO", "🏹 화살피하기 · 솔로"),
    "volleyball:CPU": ("volleyball", "CPU", "🏐 배구 · 봇전"),
    "volleyball:PVP": ("volleyball", "PVP", "🏐 배구 · 대결"),
    "omok:CPU": ("omok", "CPU", "⚫ 오목 · 봇전"),
    "omok:PVP": ("omok", "PVP", "⚫ 오목 · 대결"),
}


class _GameModeSelect(discord.ui.Select):
    def __init__(self, view: "GameStatsView"):
        self.stats_view = view
        super().__init__(placeholder="게임과 모드를 선택하세요", options=[
            discord.SelectOption(label=label, value=value, default=value == view.filter_key)
            for value, (_, _, label) in FILTERS.items()
        ], row=0)

    async def callback(self, interaction: discord.Interaction):
        self.stats_view.filter_key = self.values[0]
        _, mode, _ = FILTERS[self.values[0]]
        self.stats_view.difficulty.disabled = mode != "CPU"
        self.stats_view._refresh_defaults()
        await interaction.response.edit_message(embed=self.stats_view.filter_embed(), view=self.stats_view)


class _DifficultySelect(discord.ui.Select):
    def __init__(self, view: "GameStatsView"):
        self.stats_view = view
        game, mode, _ = FILTERS[view.filter_key]
        options = self._options(game)
        super().__init__(placeholder="봇전 난이도", options=options, disabled=mode != "CPU", row=1)

    def _options(self, game: str):
        labels = GAMES[game].difficulty_labels
        return [discord.SelectOption(label=label, value=value, default=value == self.stats_view.difficulty_key)
                for value, label in labels.items()] or [discord.SelectOption(label="해당 없음", value="normal")]

    def rebuild(self):
        game, mode, _ = FILTERS[self.stats_view.filter_key]
        self.options = self._options(game)
        self.disabled = mode != "CPU"

    async def callback(self, interaction: discord.Interaction):
        self.stats_view.difficulty_key = self.values[0]
        self.stats_view._refresh_defaults()
        await interaction.response.edit_message(embed=self.stats_view.filter_embed(), view=self.stats_view)


class GameStatsView(discord.ui.View):
    def __init__(self, store, owner_id: int, guild_id: int):
        super().__init__(timeout=180)
        self.store, self.owner_id, self.guild_id = store, owner_id, guild_id
        self.filter_key = "arrow_dodge:SOLO"
        self.difficulty_key = "normal"
        self.message = None
        self.game_mode = _GameModeSelect(self)
        self.difficulty = _DifficultySelect(self)
        self.add_item(self.game_mode); self.add_item(self.difficulty)

    def _refresh_defaults(self):
        self.game_mode.options = [discord.SelectOption(label=label, value=value, default=value == self.filter_key)
                                  for value, (_, _, label) in FILTERS.items()]
        self.difficulty.rebuild()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id == self.owner_id:
            return True
        await interaction.response.send_message("명령어를 입력한 사람만 통계 조건을 변경할 수 있습니다.", ephemeral=True)
        return False

    def filter_embed(self):
        game, mode, label = FILTERS[self.filter_key]
        difficulty = f" · {GAMES[game].difficulty_labels[self.difficulty_key]}" if mode == "CPU" else ""
        return discord.Embed(title="📊 도도새게임 통계", description=f"현재 선택: **{label}{difficulty}**\n아래 버튼으로 조회 범위를 선택하세요.", color=discord.Color.blurple())

    def _difficulty_key(self, game: str, mode: str) -> str:
        if game == "rock_run":
            return "endless" if self.filter_key == "rock_run:ENDLESS" else "normal"
        return self.difficulty_key if mode == "CPU" else ""

    @staticmethod
    def _record(stats: dict, game: str, mode: str, endless: bool = False) -> str:
        if game == "rummikub":
            return f"플레이 **{stats['plays']}회**\n누적 포인트 **{stats['total_score']:+,}점**\n봇 보정 포함 · 승패 레이팅 미사용"
        if game == "rock_run":
            value = f"{(stats.get('best_score') or 0) / 1000:.2f}초" if endless else f"{stats.get('best_score') or 0:,}점"
            return f"플레이 **{stats['plays']}회**\n최고 기록 **{value}**"
        if game == "arrow_dodge":
            best = (stats.get("best_score") or 0) / 1000
            return f"플레이 **{stats['plays']}회**\n최고 생존 **{best:.2f}초**"
        total = stats["wins"] + stats["losses"] + stats["draws"]
        rate = stats["wins"] / total * 100 if total else 0
        rating = f"\n레이팅 **{stats['rating']:,}**" if mode == "PVP" else ""
        return (f"**{stats['wins']}승 {stats['draws']}무 {stats['losses']}패**\n"
                f"승률 **{rate:.1f}%** · 최고 연승 **{stats['best_streak']}회**{rating}")

    async def _show_mine(self, interaction: discord.Interaction):
        await interaction.response.defer()
        game, mode, label = FILTERS[self.filter_key]
        stats = await self.store.player_stats(self.owner_id, game, mode, self._difficulty_key(game, mode))
        embed = self.filter_embed()
        embed.title = f"{label} · 내 전적"
        embed.description = self._record(stats, game, mode, self.filter_key == "rock_run:ENDLESS") if stats else "아직 기록된 경기가 없습니다."
        if game == "rummikub" and stats:
            history = await self.store.rummikub_history(self.owner_id)
            if history:
                embed.add_field(name="최근 10경기 · 획득/차감 포인트", value="\n".join(
                    f"<t:{int(row['ended_at'].timestamp())}:f> · **{row['score']:+,}점** · 사람 {row['humans']} / 봇 {row['bots']}"
                    for row in history), inline=False)
        await interaction.edit_original_response(embed=embed, view=self)

    async def _show_rank(self, interaction: discord.Interaction, scope_type: str):
        await interaction.response.defer()
        game, mode, label = FILTERS[self.filter_key]
        scope_id = self.guild_id if scope_type == "GUILD" else 0
        rows = await self.store.leaderboard(game, mode, scope_type, scope_id, self._difficulty_key(game, mode))
        lines = []
        medals = ["🥇", "🥈", "🥉"]
        for index, row in enumerate(rows, 1):
            prefix = medals[index - 1] if index <= 3 else f"`{index:>2}.`"
            if game == "rummikub":
                value = f"{row['total_score']:+,}점 · {row['plays']}회"
            elif game == "rock_run":
                value = f"{(row['best_score'] or 0) / 1000:.2f}초" if self.filter_key == "rock_run:ENDLESS" else f"{row['best_score'] or 0:,}점"
            elif game == "arrow_dodge":
                value = f"{(row['best_score'] or 0) / 1000:.2f}초"
            elif mode == "PVP":
                value = f"{row['rating']:,}점 · {row['wins']}승 {row['draws']}무 {row['losses']}패"
            else:
                value = f"{row['wins']}승 {row['losses']}패"
            lines.append(f"{prefix} <@{row['discord_user_id']}> · **{value}**")
        embed = self.filter_embed()
        embed.title = f"{label} · {'서버' if scope_type == 'GUILD' else '전체'} 랭킹"
        embed.description = "\n".join(lines) if lines else "아직 랭킹 기록이 없습니다."
        await interaction.edit_original_response(embed=embed, view=self)

    @discord.ui.button(label="내 전적", style=discord.ButtonStyle.primary, row=2)
    async def mine(self, interaction, _button): await self._show_mine(interaction)

    @discord.ui.button(label="서버 랭킹", style=discord.ButtonStyle.secondary, row=2)
    async def guild_rank(self, interaction, _button): await self._show_rank(interaction, "GUILD")

    @discord.ui.button(label="전체 랭킹", style=discord.ButtonStyle.secondary, row=2)
    async def global_rank(self, interaction, _button): await self._show_rank(interaction, "GLOBAL")

    async def on_timeout(self):
        for child in self.children: child.disabled = True
        if self.message:
            try: await self.message.edit(view=self)
            except discord.HTTPException: pass
