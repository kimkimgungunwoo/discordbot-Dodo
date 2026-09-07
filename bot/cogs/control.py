import discord
from discord.ext import commands


CATEGORIES: dict[str, tuple[str, str]] = {
    "control": (
        "🎙️ 봇 제어",
        "`!help` — 명령어 목록 (별칭: `!도움말`, `!명령어`)\n"
        "`!prefix` — 이 서버 prefix 확인 / 변경 (`!prefix .`, 서버 관리 권한 필요)",
    ),
    "music": (
        "🎵 음악",
        "`!음악 입장` / `!음악 퇴장` — 봇 음성 채널 입장 / 퇴장\n"
        "`!음악 추가` — 유튜브 검색해서 재생\n"
        "`!음악 목록` — 현재 곡 + 다음 곡\n"
        "`!음악 대기목록` — 전체 대기열\n"
        "`!음악 제거` — 대기열 곡 제거\n"
        "`!음악 정지` / `!음악 재생` — 일시정지 / 재개\n"
        "`!음악 스킵` — 현재 곡 건너뛰기\n"
        "> 5분간 활동이 없으면 자동 퇴장",
    ),
    "user": (
        "👤 유저",
        "`!등록` — 유저 등록 (최초 1회 1,000P)\n"
        "`!정보` — 내 정보\n"
        "`!출석` — 1일 1회, 1,000P (4% 확률 2,000P)\n"
        "`!게임기록` — 최근 게임 5판 전적·승률",
    ),
    "game": (
        "🎮 게임",
        "`!게임` — 미니게임 선택\n"
        "┣ 참참참 — 봇과 방향 다르면 승리 (+100P / -100P)\n"
        "┣ 가위바위보 — 봇과 대결 (+100P / ±0P / -100P)\n"
        "┗ 제비뽑기 — 승 60% (+100~+500P) / 패 40% (-100~-700P)",
    ),
    "gamble": (
        "🎰 도박",
        "`!도박` — 도박 선택\n"
        "┣ 홀짝 — 승 +100% / 패 전액 소멸\n"
        "┣ 경마 — 1등 +150% / 2등 -50% / 3등 전액 소멸\n"
        "┗ `!도박기록` — 최근 도박 5판 전적·승률",
    ),
    "party": (
        "👥 파티",
        "`!파티 생성` — 파티 만들기\n"
        "`!파티 목록` — 파티 목록\n"
        "`!파티 삭제` — 파티 삭제\n"
        "`!파티 멤버` — 참여자 확인",
    ),
    "ai": (
        "🤖 AI 챗봇",
        "`!AI 질문` — 1회성 질문\n"
        "`!AI 대화` — 멀티턴 대화 (최대 30턴)",
    ),
    "riot": (
        "🎮 리그 오브 레전드",
        "`!롤 프로필` — 랭크·마스터리·최근 전적 요약\n"
        "`!롤 전적` — 솔로/자유랭크 최근 5게임 상세\n"
        "`!롤 전적분석` — 포지션 보정 등급 분석\n"
        "`!롤 게임분석` — 게임 하나 골라 상세 분석\n"
        "`!롤 즐겨찾기` — 즐겨찾기 목록 / 추가 / 제거",
    ),
    "overwatch": (
        "🎮 오버워치",
        "`!오버워치 프로필` — 프로필 확인\n"
        "`!오버워치 즐겨찾기` — 즐겨찾기 목록 / 추가\n"
        "`!오버워치 분석` — 프로필 + AI 종합 분석\n"
        "`!오버워치 영웅분석` — 상위 10개 영웅 + AI 분석",
    ),
    "analytics": (
        "📊 서버 통계",
        "`!통계 채팅통계` — 채팅 순위\n"
        "`!통계 통화통계` — 통화 순위\n"
        "`!통계 유저통계` — 개인 통계\n"
        "`!통계 서버전체통계` — 서버 종합 대시보드\n"
        "> 통화·게임은 기능이 켜진 이후부터 기록",
    ),
    "etc": (
        "💬 기타",
        "`!안녕` — 인사 (별칭: `!hi`, `!하이`, `!안녕하세요`)",
    ),
}


def category_embed(key: str, prefix: str = "!") -> discord.Embed:
    title, desc = CATEGORIES[key]
    if prefix != "!":
        desc = desc.replace("`!", "`" + prefix)
    return discord.Embed(title=title, description=desc, color=discord.Color.blurple())


class HelpSelect(discord.ui.Select):
    def __init__(self, prefix: str):
        self.prefix = prefix
        options = [
            discord.SelectOption(label=title, value=key)
            for key, (title, _) in CATEGORIES.items()
        ]
        super().__init__(placeholder="카테고리를 선택하세요", options=options)

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.edit_message(embed=category_embed(self.values[0], self.prefix), view=self.view)


class HelpView(discord.ui.View):
    def __init__(self, prefix: str = "!"):
        super().__init__(timeout=120)
        self.add_item(HelpSelect(prefix))


def _valid_prefix(p: str) -> bool:
    return 1 <= len(p) <= 3 and " " not in p and p[0] not in "@/#"


class Control(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="help", aliases=["도움말", "명령어"])
    async def help(self, ctx: commands.Context):
        embed = discord.Embed(
            title="명령어 목록",
            description=f"prefix: `{ctx.clean_prefix}`\n아래 드롭다운에서 카테고리를 선택하세요.",
            color=discord.Color.blurple(),
        )
        await ctx.send(embed=embed, view=HelpView(ctx.clean_prefix))

    @commands.command(name="prefix", aliases=["프리픽스"])
    @commands.guild_only()
    async def prefix_cmd(self, ctx: commands.Context, new_prefix: str = None):
        cur = self.bot.prefixes.get(ctx.guild.id, "!")
        if new_prefix is None:
            await ctx.reply(f"현재 이 서버 prefix: `{cur}`", mention_author=False)
            return
        if not ctx.author.guild_permissions.manage_guild:
            await ctx.reply("서버 관리 권한이 필요합니다.", mention_author=False)
            return
        if not _valid_prefix(new_prefix):
            await ctx.reply("prefix는 공백 없는 1~3자여야 하고 `@` `/` `#` 로 시작할 수 없습니다.", mention_author=False)
            return
        await self.bot.set_guild_prefix(ctx.guild.id, new_prefix)
        await ctx.reply(
            f"이제 이 서버 prefix는 `{new_prefix}` 입니다.\n"
            f"다른 봇과 겹쳐서 안 먹히면 `@{ctx.me.display_name} prefix <기호>` 로도 바꿀 수 있어요.",
            mention_author=False,
        )

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild):
        ch = guild.system_channel or next(
            (c for c in guild.text_channels if c.permissions_for(guild.me).send_messages), None
        )
        if ch is None:
            return
        await ch.send(
            "👋 안녕하세요! 명령어 prefix는 기본 `!` 입니다.\n"
            f"`!prefix <기호>` 로 바꿀 수 있고, 다른 봇과 겹치면 `@{guild.me.display_name} prefix <기호>` 로도 변경돼요.\n"
            "`!help` 로 명령어를 확인하세요."
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(Control(bot))
