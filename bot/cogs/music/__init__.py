import asyncio
import os
import discord
from discord.ext import commands

from bot.cogs.control import category_embed
from bot.cogs.music.renderer import render_queue_card, render_playlist_card
from bot.cogs.music.views import (
    Track,
    MusicSearchPromptView, RemoveView, QueuePaginatorView, PlaylistControlView,
)


class Music(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # guild_id -> list[Track]  (일반 재생 대기열)
        self.queues: dict[int, list[Track]] = {}
        # guild_id -> Track (일반 재생 중인 곡)
        self.current: dict[int, Track] = {}
        # 재생목록 전용 상태 — 일반 재생과 완전히 분리해서 관리한다.
        self.playlist_queues: dict[int, list[Track]] = {}
        self.playlist_current: dict[int, Track] = {}
        self.playlist_meta: dict[int, dict] = {}  # {"title", "thumbnail", "total"}
        # guild_id -> "single" | "playlist": 지금 음성 클라이언트를 "쥐고 있는" 모드.
        # 한쪽이 재생 중일 때 반대쪽 요청이 들어오면 이 값을 기준으로 선점한다.
        self.active_mode: dict[int, str] = {}
        # guild_id -> Lock: 곡 종료 콜백과 "대기 중이면 즉시 재생" 경로가 동시에
        # advance를 부르면 current가 실제 재생곡과 어긋날 수 있어 직렬화한다.
        self._advance_locks: dict[int, asyncio.Lock] = {}

        if not discord.opus.is_loaded():
            # discord.py는 임포트 시점에 ctypes.util.find_library("opus")로 자동 로드를 시도한다.
            # 리눅스(Dockerfile에서 apt로 libopus0 설치)는 이걸로 충분하지만, macOS Homebrew는
            # 라이브러리가 표준 검색 경로 밖(/opt/homebrew, /usr/local)에 있어서 자동 로드가 실패함
            # — 존재하는 경로만 골라서 수동 로드하는 폴백.
            for candidate in ("/opt/homebrew/lib/libopus.dylib", "/usr/local/lib/libopus.dylib"):
                if os.path.exists(candidate):
                    discord.opus.load_opus(candidate)
                    break

    async def cog_unload(self):
        """Cog가 내려갈 때(핫리로드 포함) 호출된다. 여기서 정리하지 않으면
        재로드 후 새 Music 인스턴스는 텅 빈 상태로 시작하는데, 옛 인스턴스가 걸어둔
        after_play 콜백은 여전히 옛 인스턴스의 큐/상태를 참조하며 백그라운드에서
        계속 돌아가버려 — 완전히 분리된 두 "뇌"가 동시에 존재하는 상태가 된다.
        그래서 언로드 시점에 모든 음성 연결을 확실히 끊는다."""
        for vc in list(self.bot.voice_clients):
            try:
                if vc.is_playing() or vc.is_paused():
                    vc.stop()
                await vc.disconnect(force=True)
            except Exception as e:
                print(f"[Music] cog_unload 중 음성 연결 정리 실패: {e}")

        self.queues.clear()
        self.current.clear()
        self.playlist_queues.clear()
        self.playlist_current.clear()
        self.playlist_meta.clear()
        self.active_mode.clear()

    def _advance_lock(self, guild_id: int) -> asyncio.Lock:
        return self._advance_locks.setdefault(guild_id, asyncio.Lock())

    def _state(self, mode: str) -> tuple[dict, dict]:
        """mode에 해당하는 (큐 dict, 현재곡 dict) 쌍을 반환."""
        if mode == "playlist":
            return self.playlist_queues, self.playlist_current
        return self.queues, self.current

    async def switch_mode(self, guild: discord.Guild, mode: str):
        """반대 모드가 재생/일시정지 중이면 멈추고 이 모드로 전환한다.
        멈춘 트랙은 잃어버리지 않도록 그 모드의 큐 맨 앞으로 되돌려 놓는다
        (다만 오디오 소스 자체는 다시 만들어야 해서 재개 시 처음부터 다시 재생됨)."""
        vc = guild.voice_client
        guild_id = guild.id
        old_mode = self.active_mode.get(guild_id)

        if old_mode is not None and old_mode != mode and vc is not None and (vc.is_playing() or vc.is_paused()):
            old_queue, old_current = self._state(old_mode)
            interrupted = old_current.pop(guild_id, None)
            if interrupted is not None:
                old_queue.setdefault(guild_id, []).insert(0, interrupted)
            vc.stop()  # after 콜백이 old_mode로 advance를 다시 부르지만, active_mode가 이미 바뀌어 있어 아무 것도 안 함

        self.active_mode[guild_id] = mode

    async def advance(self, guild: discord.Guild, mode: str):
        async with self._advance_lock(guild.id):
            vc: discord.VoiceClient | None = guild.voice_client
            if vc is None:
                return

            # 이 모드가 더 이상 활성 모드가 아니면(반대 모드가 선점함) 아무 것도 하지 않는다.
            if self.active_mode.get(guild.id) != mode:
                return

            # 락을 기다리는 동안 다른 경로가 이미 다음 곡을 재생 시작했을 수 있다 — 중복 재생 방지.
            if vc.is_playing() or vc.is_paused():
                return

            queues, currents = self._state(mode)
            queue = queues.get(guild.id, [])

            while queue:
                track = queue.pop(0)
                if not track.is_resolved:
                    try:
                        await track.resolve()
                    except Exception as e:
                        print(f"[Music] '{track.title}' 재생 준비 실패: {e}")
                        continue  # 재생 불가한 곡은 건너뛰고 다음 곡 시도

                currents[guild.id] = track

                source = discord.FFmpegPCMAudio(track.url, **track.ffmpeg_options)
                source = discord.PCMVolumeTransformer(source, volume=0.5)

                def after_play(error, guild=guild, mode=mode):
                    if error:
                        print(f"[Music] 재생 오류: {error}")
                    asyncio.run_coroutine_threadsafe(self.advance(guild, mode), self.bot.loop)

                vc.play(source, after=after_play)
                return

            currents.pop(guild.id, None)
            if mode == "playlist":
                self.playlist_meta.pop(guild.id, None)
            if self.active_mode.get(guild.id) == mode:
                self.active_mode.pop(guild.id, None)

    @commands.group(name="음악", invoke_without_command=True)
    async def music_group(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("music"), mention_author=False)

    @music_group.command(name="입장")
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

    @music_group.command(name="추가")
    async def add_music(self, ctx: commands.Context):
        """검색창을 띄워 유튜브에서 곡을 찾고 드롭다운으로 선택합니다."""
        if ctx.voice_client is None:
            await ctx.reply("`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", mention_author=False)
            return

        await ctx.reply(
            "검색어를 입력하세요:",
            view=MusicSearchPromptView(self),
            mention_author=False,
        )

    @music_group.command(name="제거")
    async def musiclist_remove(self, ctx: commands.Context):
        """드롭다운으로 대기열 곡을 선택해 제거합니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        queue = self.queues.get(ctx.guild.id, [])
        if not queue:
            await ctx.reply("대기열이 비어있습니다.", mention_author=False)
            return

        view = RemoveView(list(queue), ctx.author)
        await ctx.reply("제거할 곡을 선택하세요:", view=view, mention_author=False)

    @music_group.command(name="목록")
    async def musiclist(self, ctx: commands.Context):
        """현재 재생곡과 다음 4곡을 카드로 보여줍니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        current = self.current.get(ctx.guild.id)
        queue = self.queues.get(ctx.guild.id, [])

        if current is None and not queue:
            await ctx.reply("현재 대기열이 비어있습니다.", mention_author=False)
            return

        async with ctx.typing():
            img = await render_queue_card(current, queue)
        await ctx.reply(file=discord.File(img, "queue.png"), mention_author=False)

    @music_group.command(name="대기목록")
    async def queue_list(self, ctx: commands.Context):
        """대기열 전체를 페이지네이션 임베드로 보여줍니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        queue = self.queues.get(ctx.guild.id, [])
        if not queue:
            await ctx.reply("대기열이 비어있습니다.", mention_author=False)
            return

        view = QueuePaginatorView(queue, ctx.author.id)
        await ctx.reply(embed=view.build_embed(), view=view, mention_author=False)

    @music_group.command(name="정지")
    async def pause(self, ctx: commands.Context):
        """일반 대기열 재생을 일시정지합니다. (재생목록은 `!음악 플레이리스트`의 중지 버튼으로 별도 제어)"""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return
        if self.active_mode.get(ctx.guild.id) != "single":
            await ctx.reply(
                "현재 재생 중인 일반 음악이 없습니다. (재생목록은 `!음악 플레이리스트`로 제어)",
                mention_author=False,
            )
            return
        if vc.is_paused():
            await ctx.reply("이미 일시정지 상태입니다.", mention_author=False)
            return
        if not vc.is_playing():
            await ctx.reply("현재 재생 중인 곡이 없습니다.", mention_author=False)
            return

        vc.pause()
        await ctx.reply("⏸️ 일시정지했습니다. `!음악 재생` 으로 재개할 수 있습니다.", mention_author=False)

    @music_group.command(name="재생")
    async def resume(self, ctx: commands.Context):
        """일반 대기열의 음악을 재생/재개합니다. 재생목록이 재생 중이었다면 멈추고(트랙 보존)
        일반 대기열로 전환합니다 — `!음악 정지`/`!음악 재생`은 항상 일반 대기열 전용입니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        guild_id = ctx.guild.id
        if self.active_mode.get(guild_id) == "single":
            if vc.is_playing():
                await ctx.reply("이미 재생 중입니다.", mention_author=False)
                return
            if vc.is_paused():
                vc.resume()
                await ctx.reply("▶️ 재생을 재개합니다.", mention_author=False)
                return

        # 재생목록이 재생/일시정지 중이었다면 여기서 선점된다 (트랙은 재생목록 큐 맨 앞으로 보존).
        await self.switch_mode(ctx.guild, "single")
        await self.advance(ctx.guild, "single")

        current = self.current.get(guild_id)
        if current:
            await ctx.reply(f"▶️ **{current.title}** 재생을 시작합니다!", mention_author=False)
        else:
            await ctx.reply("대기열에 곡이 없습니다. `!음악 추가`로 곡을 추가해주세요.", mention_author=False)

    @music_group.command(name="스킵")
    async def skip(self, ctx: commands.Context):
        """현재 재생 중인 곡을 건너뜁니다 (일반 재생/재생목록 둘 다 지원)."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None or not vc.is_playing():
            await ctx.reply("현재 재생 중인 곡이 없습니다.", mention_author=False)
            return

        mode = self.active_mode.get(ctx.guild.id, "single")
        _, currents = self._state(mode)
        current = currents.get(ctx.guild.id)
        vc.stop()  # after 콜백이 자동으로 advance 호출
        await ctx.reply(
            f"⏭️ **{current.title if current else '곡'}** 을(를) 건너뜁니다.",
            mention_author=False,
        )

    @music_group.command(name="플레이리스트")
    async def playlist(self, ctx: commands.Context):
        """재생목록을 재생/제거/중지 버튼으로 관리합니다."""
        vc: discord.VoiceClient | None = ctx.voice_client
        if vc is None:
            await ctx.reply("`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", mention_author=False)
            return

        guild_id = ctx.guild.id
        meta = self.playlist_meta.get(guild_id)
        current = self.playlist_current.get(guild_id)
        queue = self.playlist_queues.get(guild_id, [])
        view = PlaylistControlView(self)

        is_active_now = self.active_mode.get(guild_id) == "playlist" and (vc.is_playing() or vc.is_paused())

        if meta and is_active_now:
            async with ctx.typing():
                img = await render_playlist_card(meta, current, queue)
            await ctx.reply(file=discord.File(img, "playlist.png"), view=view, mention_author=False)
            return

        if meta and (current or queue):
            remaining = len(queue) + (1 if current else 0)
            await ctx.reply(
                f"📀 **{meta['title']}** — 정지됨 (남은 곡 {remaining}개). 재생 버튼을 눌러 이어보세요.",
                view=view, mention_author=False,
            )
            return

        await ctx.reply(
            "불러온 재생목록이 없습니다. 재생 버튼을 눌러 링크를 입력하세요.",
            view=view, mention_author=False,
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(Music(bot))
