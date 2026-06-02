import discord
from discord.ext import commands


class Control(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @commands.command(name="bot")
    async def join(self, ctx: commands.Context):
        """봇을 현재 음성 채널에 입장시킵니다."""
        if ctx.author.voice is None:
            await ctx.send("먼저 음성 채널에 입장하세요!")
            return

        channel = ctx.author.voice.channel
        vc: discord.VoiceClient | None = ctx.voice_client

        if vc is not None:
            if vc.channel == channel:
                await ctx.send("이미 해당 음성 채널에 있습니다.")
                return
            await vc.move_to(channel)
        else:
            await channel.connect()

        await ctx.send(f"🎙️ **{channel.name}** 채널에 입장했습니다.")

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
            name="🎮 게임",
            value="`!game` — 미니게임 (별칭: `!게임`)",
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
