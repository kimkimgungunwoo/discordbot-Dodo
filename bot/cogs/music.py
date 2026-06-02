import asyncio
import discord
from discord.ext import commands
import yt_dlp

# 검색 전용 옵션: 메타데이터만 빠르게 수집
YTDL_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,   # 각 항목을 완전히 처리하지 않고 메타데이터만
    "noplaylist": False,    # 검색 결과(플레이리스트 형태)를 허용
}

# 실제 스트리밍 URL 추출 옵션
YTDL_STREAM_OPTS = {
    "format": "bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
}

FFMPEG_OPTS = {
    "before_options": "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5",
    "options": "-vn",
}


def format_duration(seconds) -> str:
    seconds = int(seconds or 0)
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


class Track:
    """재생할 곡 정보를 담는 클래스"""
    def __init__(self, data: dict, requester: discord.Member):
        self.title: str = data.get("title", "알 수 없는 제목")
        self.url: str = data["url"]          # 스트리밍 URL
        self.webpage_url: str = data.get("webpage_url", "")
        self.uploader: str = data.get("uploader") or data.get("channel", "알 수 없음")
        self.duration: int = data.get("duration", 0)
        self.thumbnail: str = data.get("thumbnail", "")
        self.requester = requester

    def __str__(self) -> str:
        return self.title


async def search_youtube(query: str, count: int = 10) -> list[dict]:
    """유튜브에서 count개의 검색 결과를 반환 (메타데이터만)"""
    loop = asyncio.get_running_loop()

    def _search():
        with yt_dlp.YoutubeDL(YTDL_SEARCH_OPTS) as ydl:
            result = ydl.extract_info(f"ytsearch{count}:{query}", download=False)
            return result.get("entries", []) if result else []

    return await asyncio.wait_for(
        loop.run_in_executor(None, _search),
        timeout=30,
    )


async def fetch_track(entry: dict, requester: discord.Member) -> Track:
    """선택된 항목에서 실제 스트리밍 URL을 포함한 Track을 가져옵니다."""
    loop = asyncio.get_running_loop()
    url = entry.get("url") or entry.get("webpage_url") or entry.get("id")

    def _fetch():
        with yt_dlp.YoutubeDL(YTDL_STREAM_OPTS) as ydl:
            return ydl.extract_info(url, download=False)

    data = await asyncio.wait_for(
        loop.run_in_executor(None, _fetch),
        timeout=30,
    )
    return Track(data, requester)


class MusicSelect(discord.ui.Select):
    def __init__(self, entries: list[dict], requester: discord.Member):
        self.entries = entries
        self.requester = requester
        options = []
        for i, e in enumerate(entries):
            dur = format_duration(e.get("duration") or 0)
            uploader = e.get("uploader") or e.get("channel") or "알 수 없음"
            options.append(
                discord.SelectOption(
                    label=e.get("title", "제목 없음")[:100],
                    description=f"{uploader} • {dur}"[:100],
                    value=str(i),
                )
            )
        super().__init__(placeholder="재생할 곡을 선택하세요...", options=options)

    async def callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.requester.id:
            await interaction.response.send_message(
                "명령어를 실행한 사람만 선택할 수 있습니다.", ephemeral=True
            )
            return

        # 드롭다운 비활성화
        self.disabled = True
        self.view.stop()
        await interaction.response.edit_message(view=self.view)

        vc: discord.VoiceClient | None = interaction.guild.voice_client
        if vc is None:
            await interaction.followup.send(
                "`!bot` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", ephemeral=True
            )
            return

        await interaction.followup.send("🔍 곡 정보를 불러오는 중...")
        try:
            track = await fetch_track(self.entries[int(self.values[0])], interaction.user)
        except asyncio.TimeoutError:
            await interaction.followup.send("⏱️ 곡 정보를 불러오는 데 너무 오래 걸렸습니다. 다시 시도해주세요.")
            return
        except Exception as e:
            await interaction.followup.send(f"❌ 곡 정보를 불러오지 못했습니다: {e}")
            return

        cog: Music = interaction.client.cogs.get("Music")
        guild_id = interaction.guild.id

        cog.queues.setdefault(guild_id, []).append(track)

        if not vc.is_playing() and not vc.is_paused():
            await cog.play_next(interaction.guild)
            await interaction.followup.send(f"▶️ **{track.title}** 재생을 시작합니다!")
        else:
            pos = len(cog.queues[guild_id])
            await interaction.followup.send(
                f"✅ **{track.title}** 이(가) 대기열 {pos}번에 추가되었습니다."
            )


class MusicView(discord.ui.View):
    def __init__(self, entries: list[dict], requester: discord.Member):
        super().__init__(timeout=30)
        self.add_item(MusicSelect(entries, requester))


class RemoveSelect(discord.ui.Select):
    def __init__(self, queue: list, requester: discord.Member):
        self.queue = queue
        self.requester = requester
        options = [
            discord.SelectOption(
                label=t.title[:100],
                description=f"{t.uploader} • {format_duration(t.duration)}"[:100],
                value=str(i),
            )
            for i, t in enumerate(queue)
        ]
        super().__init__(placeholder="제거할 곡을 선택하세요...", options=options)

    async def callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.requester.id:
            await interaction.response.send_message(
                "명령어를 실행한 사람만 선택할 수 있습니다.", ephemeral=True
            )
            return

        self.disabled = True
        self.view.stop()
        await interaction.response.edit_message(view=self.view)

        idx = int(self.values[0])
        cog: Music = interaction.client.cogs.get("Music")
        queue = cog.queues.get(interaction.guild.id, [])

        if idx >= len(queue):
            await interaction.followup.send("이미 제거된 곡입니다.", ephemeral=True)
            return

        removed = queue.pop(idx)
        await interaction.followup.send(
            f"🗑️ **{removed.title}** 이(가) 대기열에서 제거되었습니다."
        )


class RemoveView(discord.ui.View):
    def __init__(self, queue: list, requester: discord.Member):
        super().__init__(timeout=30)
        self.add_item(RemoveSelect(queue, requester))


class Music(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # guild_id -> list[Track]
        self.queues: dict[int, list[Track]] = {}
        # guild_id -> Track (현재 재생 중)
        self.current: dict[int, Track] = {}

        if not discord.opus.is_loaded():
            discord.opus.load_opus("/opt/homebrew/lib/libopus.dylib")

    async def play_next(self, guild: discord.Guild):
        vc: discord.VoiceClient | None = guild.voice_client
        if vc is None:
            return

        queue = self.queues.get(guild.id, [])
        if not queue:
            self.current.pop(guild.id, None)
            return

        track = queue.pop(0)
        self.current[guild.id] = track

        source = discord.FFmpegPCMAudio(track.url, **FFMPEG_OPTS)
        source = discord.PCMVolumeTransformer(source, volume=0.5)

        def after_play(error):
            if error:
                print(f"[Music] 재생 오류: {error}")
            asyncio.run_coroutine_threadsafe(self.play_next(guild), self.bot.loop)

        vc.play(source, after=after_play)

    @commands.command(name="bot",aliases=["봇"])
    async def join(self, ctx: commands.Context):
        """봇을 현재 음성 채널에 입장시킵니다."""
        if ctx.author.voice is None:
            await ctx.reply("먼저 음성 채널에 입장하세요!", mention_author=False)
            return

        channel = ctx.author.voice.channel
        vc: discord.VoiceClient | None = ctx.voice_client

        if vc is not None:
            if vc.channel == channel:
                await ctx.reply("이미 해당 음성 채널에 있습니다.", mention_author=False)
                return
            await vc.move_to(channel)
        else:
            await channel.connect()

        await ctx.reply(f"🎙️ **{channel.name}** 채널에 입장했습니다.", mention_author=False)

    @commands.command(name="music",aliases=["노래","음악"])
    async def music(self, ctx: commands.Context, *, query: str):
        """유튜브 뮤직에서 곡을 검색하고 드롭다운으로 선택합니다."""
        if ctx.voice_client is None:
            await ctx.reply("`!bot` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", mention_author=False)
            return

        async with ctx.typing():
            entries = await search_youtube(query, count=10)

        if not entries:
            await ctx.reply("검색 결과가 없습니다.", mention_author=False)
            return

        embed = discord.Embed(
            title=f"🎵 '{query}' 검색 결과",
            description="아래 드롭다운에서 재생할 곡을 선택하세요.\n(30초 내 선택하지 않으면 취소됩니다.)",
            color=discord.Color.red(),
        )
        for i, e in enumerate(entries, 1):
            dur = format_duration(e.get("duration") or 0)
            uploader = e.get("uploader") or e.get("channel") or "알 수 없음"
            embed.add_field(
                name=f"{i}. {e.get('title', '제목 없음')[:50]}",
                value=f"{uploader} • {dur}",
                inline=False,
            )

        view = MusicView(entries, ctx.author)
        await ctx.reply(embed=embed, view=view, mention_author=False)

    @commands.command(name="musiclist",aliases=["노래목록","음악목록"])
    async def musiclist(self, ctx: commands.Context, action: str = None):
        """
        !musiclist   — 현재 대기열 확인
        !musiclist r — 드롭다운으로 곡 선택 후 제거
        """
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        if action and action.lower() == "r":
            queue = self.queues.get(ctx.guild.id, [])
            if not queue:
                await ctx.reply("대기열이 비어있습니다.", mention_author=False)
                return

            view = RemoveView(list(queue), ctx.author)
            await ctx.reply("제거할 곡을 선택하세요:", view=view, mention_author=False)
            return

        # 대기열 확인
        current = self.current.get(ctx.guild.id)
        queue = self.queues.get(ctx.guild.id, [])

        if current is None and not queue:
            await ctx.reply("현재 대기열이 비어있습니다.", mention_author=False)
            return

        embed = discord.Embed(title="📋 음악 대기열", color=discord.Color.blue())

        if current:
            embed.add_field(
                name="▶️ 현재 재생 중",
                value=f"**{current.title}**\n{current.uploader} • {format_duration(current.duration)}",
                inline=False,
            )

        if queue:
            lines = [
                f"`{i + 1}.` **{t.title}** — {t.uploader} • {format_duration(t.duration)}"
                for i, t in enumerate(queue)
            ]
            queue_text = "\n".join(lines)
            if len(queue_text) > 1024:
                queue_text = queue_text[:1021] + "..."
            embed.add_field(name="⏳ 대기열", value=queue_text, inline=False)
        else:
            embed.add_field(name="⏳ 대기열", value="대기 중인 곡이 없습니다.", inline=False)

        await ctx.reply(embed=embed, mention_author=False)

    @commands.command(name="pause",aliases=["정지"])
    async def pause(self, ctx: commands.Context):
        """재생을 일시정지하거나 재개합니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None or (not vc.is_playing() and not vc.is_paused()):
            await ctx.reply("현재 재생 중인 곡이 없습니다.", mention_author=False)
            return

        if vc.is_paused():
            vc.resume()
            await ctx.reply("▶️ 재생을 재개합니다.", mention_author=False)
        else:
            vc.pause()
            await ctx.reply("⏸️ 일시정지했습니다. `!pause` 로 재개할 수 있습니다.", mention_author=False)

    @commands.command(name="skip",aliases=["스킵"])
    async def skip(self, ctx: commands.Context):
        """현재 재생 중인 곡을 건너뜁니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None or not vc.is_playing():
            await ctx.reply("현재 재생 중인 곡이 없습니다.", mention_author=False)
            return

        current = self.current.get(ctx.guild.id)
        vc.stop()  # after 콜백이 자동으로 play_next 호출
        await ctx.reply(
            f"⏭️ **{current.title}** 을(를) 건너뜁니다.",
            mention_author=False,
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(Music(bot))
