import discord
from discord.ext import commands


class Control(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="help", aliases=["도움말", "명령어"])
    async def help(self, ctx: commands.Context):
        """사용 가능한 명령어 목록을 보여줍니다."""
        embed = discord.Embed(
            title="명령어 목록",
            description="prefix: `!`",
            color=discord.Color.blurple(),
        )

        embed.add_field(
            name="🎙️ 봇 제어",
            value=(
                "`!bot` — 현재 음성 채널에 봇 입장\n"
                "`!help` — 명령어 목록 (별칭: `!도움말`, `!명령어`)"
            ),
            inline=False,
        )

        embed.add_field(
            name="🎵 음악",
            value=(
                "`!music <노래이름>` — 유튜브에서 검색 후 드롭다운 선택 재생\n"
                "`!musiclist` — 현재 대기열 확인\n"
                "`!musiclist r` — 드롭다운으로 대기열 곡 제거\n"
                "`!pause` — 일시정지 / 재개 (토글)\n"
                "`!skip` — 현재 곡 건너뛰기"
            ),
            inline=False,
        )

        embed.add_field(
            name="👤 유저",
            value=(
                "`!등록` — 유저 등록 (최초 1회, 1,000P 지급)\n"
                "`!정보` — 내 정보 확인\n"
                "`!출석` — 출석 체크 (1일 1회, 1,000P / 4% 확률로 2,000P)\n"
                "`!게임기록` — 최근 게임 5판 전적 및 승률 확인"
            ),
            inline=False,
        )

        embed.add_field(
            name="🎮 게임",
            value=(
                "`!game` — 미니게임 선택 (별칭: `!게임`)\n"
                "┣ 참참참 — 봇과 방향이 다르면 승리 (+100P / -100P)\n"
                "┣ 가위바위보 — 봇과 대결 (+100P / ±0P / -100P)\n"
                "┗ 제비뽑기 — 운에 맡겨라! 승 60% (+100~+500P) / 패 40% (-100~-700P)"
            ),
            inline=False,
        )

        embed.add_field(
            name="👥 파티",
            value=(
                "`!party` — 파티 생성\n"
                "`!partylist` — 파티 목록\n"
                "`!partydel` — 파티 삭제\n"
                "`!partymembers` — 파티 멤버 확인"
            ),
            inline=False,
        )

        embed.add_field(
            name="🤖 AI 챗봇",
            value=(
                "`!g <질문>` — AI에게 질문 (별칭: `!AI`)\n"
                "`!c <메시지>` — 멀티턴 챗봇 (별칭: `!chat`, `!챗봇`, `!gemini`)"
            ),
            inline=False,
        )

        embed.add_field(
            name="💬 기타",
            value="`!안녕` — 인사 (별칭: `!hi`, `!하이`, `!안녕하세요`)",
            inline=False,
        )

        await ctx.send(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(Control(bot))
