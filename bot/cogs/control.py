import discord
from discord.ext import commands


CATEGORIES: dict[str, tuple[str, str]] = {
    "control": (
        "🎙️ 봇 제어",
        "`!help` — 명령어 목록 (별칭: `!도움말`, `!명령어`)",
    ),
    "music": (
        "🎵 음악",
        "`!음악 입장` — 현재 음성 채널에 봇 입장\n"
        "`!음악 퇴장` — 음성 채널에서 퇴장 (대기열 초기화)\n"
        "`!음악 추가` — 검색창을 열어 유튜브 검색 후 드롭다운 선택 재생\n"
        "`!음악 목록` — 현재 재생곡 + 다음 4곡 카드로 확인\n"
        "`!음악 대기목록` — 전체 대기열 (페이지네이션)\n"
        "`!음악 제거` — 드롭다운으로 대기열 곡 제거\n"
        "`!음악 정지` — 일시정지\n"
        "`!음악 재생` — 일시정지한 곡 재개\n"
        "`!음악 스킵` — 현재 곡 건너뛰기\n"
        "> 5분간 재생 활동이 없으면 자동으로 음성 채널에서 퇴장합니다.",
    ),
    "user": (
        "👤 유저",
        "`!등록` — 유저 등록 (최초 1회, 1,000P 지급)\n"
        "`!정보` — 내 정보 확인\n"
        "`!출석` — 출석 체크 (1일 1회, 1,000P / 4% 확률로 2,000P)\n"
        "`!게임기록` — 최근 게임 5판 전적 및 승률 확인",
    ),
    "game": (
        "🎮 게임",
        "`!game` — 미니게임 선택 (별칭: `!게임`)\n"
        "┣ 참참참 — 봇과 방향이 다르면 승리 (+100P / -100P)\n"
        "┣ 가위바위보 — 봇과 대결 (+100P / ±0P / -100P)\n"
        "┗ 제비뽑기 — 운에 맡겨라! 승 60% (+100~+500P) / 패 40% (-100~-700P)",
    ),
    "gamble": (
        "🎰 도박",
        "`!도박` — 도박 선택\n"
        "┣ 홀짝 — 배팅 후 홀/짝 선택. 승리 시 순이익 100%, 패배 시 전액 소멸\n"
        "┣ 경마 — 배팅 후 말 선택. 1등 순이익 150% / 2등 50% 손실 / 3등 전액 소멸\n"
        "┗ `!도박기록` — 최근 도박 5판 전적 및 승률 확인",
    ),
    "party": (
        "👥 파티",
        "`!파티 생성` — 입력창으로 시간/제목 입력 후 초대할 사람·역할(@everyone 포함) 선택\n"
        "`!파티 목록` — 파티장·참가자 수 카드로 확인\n"
        "`!파티 삭제 <번호>` — 파티 삭제\n"
        "`!파티 멤버 <번호>` — 파티 멤버 확인",
    ),
    "ai": (
        "🤖 AI 챗봇",
        "`!AI 질문` — 버튼을 눌러 입력창을 열고 질문, 1회성 답변\n"
        "`!AI 대화` — 전용 스레드에서 멀티턴 대화 (최대 30턴, '그만' 버튼으로 종료)",
    ),
    "riot": (
        "🎮 리그 오브 레전드",
        "`!롤 프로필` — 랭크·마스터리·최근 전적 요약\n"
        "`!롤 전적` — 솔로/자유랭크 최근 5게임 상세 전적\n"
        "`!롤 전적분석` — 최근 게임 포지션 보정 등급 분석\n"
        "`!롤 게임분석` — 게임 하나를 골라 팀 스코어보드·게임 흐름 상세분석\n"
        "`!롤 즐겨찾기` — 즐겨찾기 계정 목록 확인 / 추가 / 제거",
    ),
    "etc": (
        "💬 기타",
        "`!안녕` — 인사 (별칭: `!hi`, `!하이`, `!안녕하세요`)",
    ),
}


def category_embed(key: str) -> discord.Embed:
    title, desc = CATEGORIES[key]
    return discord.Embed(title=title, description=desc, color=discord.Color.blurple())


class HelpSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label=title, value=key)
            for key, (title, _) in CATEGORIES.items()
        ]
        super().__init__(placeholder="카테고리를 선택하세요", options=options)

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.edit_message(embed=category_embed(self.values[0]), view=self.view)


class HelpView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=120)
        self.add_item(HelpSelect())


class Control(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="help", aliases=["도움말", "명령어"])
    async def help(self, ctx: commands.Context):
        """사용 가능한 명령어 목록을 보여줍니다."""
        embed = discord.Embed(
            title="명령어 목록",
            description="prefix: `!`\n아래 드롭다운에서 카테고리를 선택하세요.",
            color=discord.Color.blurple(),
        )
        await ctx.send(embed=embed, view=HelpView())


async def setup(bot: commands.Bot):
    await bot.add_cog(Control(bot))
