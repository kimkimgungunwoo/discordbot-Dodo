import asyncio
import discord
from discord.ext import commands
import random

from api.database import SessionLocal
from api.crud.user_crud import get_user
from api.crud.gamble_log_crud import create_gamble_log
from api.models.enums import GambleType

# ── 경마 상수 ──────────────────────────────────────────
TRACK_LEN     = 20
MAX_TICKS     = 20   # 20 * 0.7s = 14초 (버퍼 포함)
TICK_INTERVAL = 0.7
HORSE_EMOJIS  = ["🐴", "🦌", "🐂"]
# 5% 후진(-1), 평균 약 1.9/tick → 20칸 기준 약 10틱 ≈ 7초
STEP_POOL = [-1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]
RANK_MEDALS   = {1: "🥇", 2: "🥈", 3: "🥉"}


class RacerState:
    def __init__(self, idx: int):
        self.idx   = idx
        self.emoji = HORSE_EMOJIS[idx]
        self.pos   = 0
        self.rank: int | None = None

    def tick(self):
        self.pos = max(0, self.pos + random.choice(STEP_POOL))

    @property
    def finished(self) -> bool:
        return self.pos >= TRACK_LEN


def _render_race(racers: list[RacerState], user_idx: int) -> str:
    lines = []
    for r in racers:
        pos = min(r.pos, TRACK_LEN)
        if r.finished:
            bar = "━" * TRACK_LEN + r.emoji
        else:
            bar = "━" * pos + r.emoji + "╌" * (TRACK_LEN - pos)
        you  = " ← 내 말" if r.idx == user_idx else ""
        rank = f"  **{r.rank}위**" if r.rank else ""
        lines.append(f"{bar} 🏁{rank}{you}")
    return "\n".join(lines)


async def _validate_bet(interaction: discord.Interaction, raw: str) -> int | None:
    try:
        bet = int(raw.strip())
    except ValueError:
        await interaction.response.send_message("숫자만 입력해주세요.", ephemeral=True)
        return None

    async with SessionLocal() as session:
        user = await get_user(session, interaction.user.id)

    if user is None:
        await interaction.response.send_message("`!등록` 명령어로 먼저 등록해주세요.", ephemeral=True)
        return None
    if bet <= 0:
        await interaction.response.send_message("1P 이상 입력해주세요.", ephemeral=True)
        return None
    if bet > user.point:
        await interaction.response.send_message(
            f"보유 포인트({user.point:,}P)를 초과했습니다.", ephemeral=True
        )
        return None
    return bet


# ── Views & Modals ─────────────────────────────────────

class GambleSelectView(discord.ui.View):
    def __init__(self, cog: "Gamble"):
        super().__init__(timeout=None)
        self.add_item(GambleSelect(cog))


class GambleSelect(discord.ui.Select):
    def __init__(self, cog: "Gamble"):
        self.cog = cog
        options = [
            discord.SelectOption(label="홀짝",  value="holcham"),
            discord.SelectOption(label="경마",  value="racing"),
        ]
        super().__init__(placeholder="도박 선택", min_values=1, max_values=1, options=options)

    async def callback(self, interaction: discord.Interaction):
        if self.values[0] == "holcham":
            await self.cog.start_holcham(interaction)
        else:
            await self.cog.start_racing(interaction)


# ── 홀짝 ───────────────────────────────────────────────

class HolChamBetModal(discord.ui.Modal, title="홀짝 — 배팅 입력"):
    amount = discord.ui.TextInput(
        label="배팅 포인트",
        placeholder="숫자만 입력 (보유 포인트 이하)",
        min_length=1, max_length=10,
    )

    def __init__(self, cog: "Gamble"):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        bet = await _validate_bet(interaction, self.amount.value)
        if bet is None:
            return
        embed = discord.Embed(
            title="🎲 홀짝",
            description=f"{interaction.user.mention}\n배팅: **{bet:,}P**\n홀 또는 짝을 선택하세요!",
            color=discord.Color.gold(),
        )
        await interaction.response.send_message(embed=embed, view=HolChamView(self.cog, bet))


class HolChamView(discord.ui.View):
    def __init__(self, cog: "Gamble", bet: int):
        super().__init__(timeout=None)
        self.cog = cog
        self.bet = bet

    @discord.ui.button(label="홀", style=discord.ButtonStyle.primary)
    async def odd(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_holcham(interaction, "홀", self.bet)

    @discord.ui.button(label="짝", style=discord.ButtonStyle.primary)
    async def even(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.play_holcham(interaction, "짝", self.bet)


class HolChamResultView(discord.ui.View):
    def __init__(self, cog: "Gamble"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="다시하기", style=discord.ButtonStyle.primary)
    async def retry(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.start_holcham(interaction)


# ── 경마 ───────────────────────────────────────────────

class RacingBetModal(discord.ui.Modal, title="경마 — 배팅 입력"):
    amount = discord.ui.TextInput(
        label="배팅 포인트",
        placeholder="숫자만 입력 (보유 포인트 이하)",
        min_length=1, max_length=10,
    )

    def __init__(self, cog: "Gamble"):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        bet = await _validate_bet(interaction, self.amount.value)
        if bet is None:
            return
        embed = discord.Embed(
            title="🏇 경마",
            description=f"배팅: **{bet:,}P**\n출전할 말을 선택하세요!",
            color=discord.Color.gold(),
        )
        await interaction.response.send_message(
            embed=embed, view=HorseSelectView(self.cog, bet)
        )


class HorseSelectView(discord.ui.View):
    def __init__(self, cog: "Gamble", bet: int):
        super().__init__(timeout=None)
        for i, emoji in enumerate(HORSE_EMOJIS):
            self.add_item(HorseButton(cog, bet, i, emoji))


class HorseButton(discord.ui.Button):
    def __init__(self, cog: "Gamble", bet: int, idx: int, emoji: str):
        super().__init__(label=emoji, style=discord.ButtonStyle.primary)
        self.cog   = cog
        self.bet   = bet
        self.idx   = idx

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.defer()
        await self.cog.run_race(interaction.message, interaction.user.id, self.bet, self.idx)


class RacingResultView(discord.ui.View):
    def __init__(self, cog: "Gamble"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="다시하기", style=discord.ButtonStyle.primary)
    async def retry(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.start_racing(interaction)


# ── Cog ────────────────────────────────────────────────

class Gamble(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="도박")
    async def gamble(self, ctx: commands.Context):
        await ctx.send("도박을 선택하세요", view=GambleSelectView(self))

    # 홀짝
    async def start_holcham(self, interaction: discord.Interaction):
        await interaction.response.send_modal(HolChamBetModal(self))

    async def play_holcham(self, interaction: discord.Interaction, user_pick: str, bet: int):
        async with SessionLocal() as session:
            user = await get_user(session, interaction.user.id)
            if user is None:
                await interaction.response.edit_message(
                    content="`!등록` 명령어로 먼저 등록해주세요.", embed=None, view=None)
                return
            if bet > user.point:
                await interaction.response.edit_message(
                    content=f"보유 포인트({user.point:,}P)가 부족합니다.", embed=None, view=None)
                return

            roll       = random.randint(1, 100)
            bot_result = "홀" if roll % 2 == 1 else "짝"
            if user_pick == bot_result:
                result, color, delta = "승리", discord.Color.blue(), bet
            else:
                result, color, delta = "패배", discord.Color.red(), -bet

            await create_gamble_log(session, user, GambleType.holcham, delta)
            new_point = user.point

        pt = f"+{delta:,}P" if delta > 0 else f"{delta:,}P"
        embed = discord.Embed(title="🎲 홀짝 결과", color=color)
        embed.add_field(name="주사위",  value=f"**{roll}** ({bot_result})", inline=True)
        embed.add_field(name="내 선택", value=f"**{user_pick}**",           inline=True)
        embed.add_field(name="결과",    value=f"**{result}**",              inline=False)
        embed.add_field(name="포인트",  value=f"{pt} → **{new_point:,}P**", inline=True)
        await interaction.response.edit_message(embed=embed, view=HolChamResultView(self))

    # 경마
    async def start_racing(self, interaction: discord.Interaction):
        await interaction.response.send_modal(RacingBetModal(self))

    async def run_race(
        self,
        message: discord.Message,
        user_id: int,
        bet: int,
        horse_idx: int,
    ):
        racers        = [RacerState(i) for i in range(3)]
        finished_cnt  = 0

        for _ in range(MAX_TICKS):
            await asyncio.sleep(TICK_INTERVAL)

            for r in racers:
                if r.rank is None:
                    r.tick()
                    if r.finished:
                        r.pos        = TRACK_LEN
                        finished_cnt += 1
                        r.rank       = finished_cnt

            embed = discord.Embed(
                title="🏇 경마 진행 중...",
                description=_render_race(racers, horse_idx),
                color=discord.Color.gold(),
            )
            embed.set_footer(text=f"배팅: {bet:,}P")
            try:
                await message.edit(embed=embed)
            except discord.NotFound:
                return

            if finished_cnt >= 2:
                for r in racers:
                    if r.rank is None:
                        r.rank = 3
                break

        # 시간 초과 시 남은 말 위치로 순위 결정
        if any(r.rank is None for r in racers):
            unfinished = sorted(
                [r for r in racers if r.rank is None],
                key=lambda r: r.pos, reverse=True
            )
            for r in unfinished:
                finished_cnt += 1
                r.rank = finished_cnt

        # 결과 계산
        user_rank = racers[horse_idx].rank
        if user_rank == 1:
            delta = int(bet * 1.5)
            result_str, color = "1등 🎉", discord.Color.blue()
        elif user_rank == 2:
            delta = -int(bet * 0.5)
            result_str, color = "2등", discord.Color.orange()
        else:
            delta = -bet
            result_str, color = "3등", discord.Color.red()

        async with SessionLocal() as session:
            user = await get_user(session, user_id)
            if user:
                await create_gamble_log(session, user, GambleType.racing, delta)
                new_point = user.point
            else:
                new_point = 0

        sorted_racers = sorted(racers, key=lambda r: r.rank)
        ranking = "\n".join(
            f"{RANK_MEDALS[r.rank]} {r.emoji}" + (" ← 내 말" if r.idx == horse_idx else "")
            for r in sorted_racers
        )
        pt = f"+{delta:,}P" if delta > 0 else f"{delta:,}P"

        embed = discord.Embed(
            title=f"🏁 경마 결과 — {result_str}",
            description=_render_race(racers, horse_idx),
            color=color,
        )
        embed.add_field(name="순위",   value=ranking,                      inline=False)
        embed.add_field(name="포인트", value=f"{pt} → **{new_point:,}P**", inline=True)
        try:
            await message.edit(embed=embed, view=RacingResultView(self))
        except discord.NotFound:
            pass


async def setup(bot: commands.Bot):
    await bot.add_cog(Gamble(bot))
