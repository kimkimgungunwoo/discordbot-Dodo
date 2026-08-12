from __future__ import annotations
import asyncio
import discord
from typing import TYPE_CHECKING
import yt_dlp

from bot.cogs.music.renderer import render_playlist_card

if TYPE_CHECKING:
    from bot.cogs.music import Music

# 검색 전용 옵션: 메타데이터만 빠르게 수집
YTDL_SEARCH_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,   # 각 항목을 완전히 처리하지 않고 메타데이터만
    "noplaylist": False,    # 검색 결과(플레이리스트 형태)를 허용
}

# 실제 스트리밍 URL 추출 옵션
# player_client를 android_vr 등 자동 선택에 맡기면 종종 재생 시점에 403이 나는 URL을 준다 —
# android/web 클라이언트로 고정해 좀 더 안정적인 URL을 받는다.
YTDL_STREAM_OPTS = {
    "format": "bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
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
    """재생할 곡 정보를 담는 클래스.
    url이 없으면 '미해석' 상태 — 재생목록에서 가볍게 메타데이터만 가져온 경우로,
    재생 직전에 resolve()로 실제 스트리밍 URL을 해석한다 (한꺼번에 수십 곡을 미리 해석하면
    느리고, 큐에 오래 묵혀두면 URL이 만료돼 403이 날 수 있어서)."""
    def __init__(self, data: dict, requester: discord.Member):
        self.title: str = data.get("title", "알 수 없는 제목")
        self.url: str | None = data.get("url")          # 스트리밍 URL, 미해석이면 None
        self.webpage_url: str = data.get("webpage_url") or data.get("url") or ""
        self.uploader: str = data.get("uploader") or data.get("channel", "알 수 없음")
        self.duration: int = data.get("duration", 0) or 0
        self.thumbnail: str = data.get("thumbnail", "")
        self.http_headers: dict = data.get("http_headers") or {}
        self.requester = requester

    def __str__(self) -> str:
        return self.title

    @property
    def is_resolved(self) -> bool:
        return bool(self.url)

    async def resolve(self):
        """미해석 상태라면 실제 스트리밍 URL과 헤더를 가져와 채운다."""
        if self.is_resolved:
            return
        loop = asyncio.get_running_loop()

        def _fetch():
            with yt_dlp.YoutubeDL(YTDL_STREAM_OPTS) as ydl:
                return ydl.extract_info(self.webpage_url, download=False)

        data = await asyncio.wait_for(loop.run_in_executor(None, _fetch), timeout=30)
        self.url = data["url"]
        self.http_headers = data.get("http_headers") or {}

    @property
    def ffmpeg_options(self) -> dict:
        """스트리밍 URL을 발급한 요청과 동일한 헤더(특히 User-Agent)를 실어 보내지 않으면
        구글 CDN이 403을 반환한다 — yt-dlp가 알려주는 http_headers를 ffmpeg -headers로 그대로 전달."""
        opts = dict(FFMPEG_OPTS)
        if self.http_headers:
            header_block = "".join(f"{k}: {v}\r\n" for k, v in self.http_headers.items())
            opts["before_options"] = f'{opts["before_options"]} -headers "{header_block}"'
        return opts

    @property
    def duration_str(self) -> str:
        return format_duration(self.duration)


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


async def run_music_search(cog: "Music", interaction: discord.Interaction, query: str):
    """검색어로 유튜브를 검색해 결과 드롭다운을 보여준다.
    새 메시지를 만들지 않고 원본 메시지(검색 프롬프트)를 계속 편집한다 — 채널에 메시지가 쌓이지 않도록."""
    entries = await search_youtube(query, count=10)
    if not entries:
        await interaction.edit_original_response(content="검색 결과가 없습니다.", embed=None, view=None)
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

    view = MusicView(entries, interaction.user)
    await interaction.edit_original_response(content=None, embed=embed, view=view)


class MusicSearchModal(discord.ui.Modal, title="음악 검색"):
    query = discord.ui.TextInput(
        label="검색어",
        placeholder="노래 제목이나 아티스트를 입력하세요",
        min_length=1, max_length=100,
    )

    def __init__(self, cog: "Music"):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer()
        await run_music_search(self.cog, interaction, self.query.value.strip())


class MusicSearchPromptView(discord.ui.View):
    def __init__(self, cog: "Music"):
        super().__init__(timeout=60)
        self.cog = cog

    @discord.ui.button(label="🔍 검색", style=discord.ButtonStyle.primary)
    async def search(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await interaction.response.send_modal(MusicSearchModal(self.cog))


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

        # 새 메시지 대신 검색 결과 메시지를 계속 편집해서 최종적으로 "대기열 추가" 문구 하나만 남긴다.
        await interaction.response.defer()
        await interaction.edit_original_response(content="🔍 곡 정보를 불러오는 중...", embed=None, view=None)

        vc: discord.VoiceClient | None = interaction.guild.voice_client
        if vc is None:
            await interaction.edit_original_response(
                content="`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요."
            )
            return

        try:
            track = await fetch_track(self.entries[int(self.values[0])], interaction.user)
        except asyncio.TimeoutError:
            await interaction.edit_original_response(content="⏱️ 곡 정보를 불러오는 데 너무 오래 걸렸습니다. 다시 시도해주세요.")
            return
        except Exception as e:
            await interaction.edit_original_response(content=f"❌ 곡 정보를 불러오지 못했습니다: {e}")
            return

        cog: "Music" = interaction.client.cogs.get("Music")
        guild_id = interaction.guild.id

        pos = len(cog.queues.setdefault(guild_id, [])) + 1
        cog.queues[guild_id].append(track)

        # 재생목록이 재생 중이었다면 멈추고(트랙은 재생목록 큐 맨 앞으로 보존) 일반 재생으로 전환한다.
        await cog.switch_mode(interaction.guild, "single")
        await cog.advance(interaction.guild, "single")

        if cog.current.get(guild_id) is track:
            await interaction.edit_original_response(content=f"▶️ **{track.title}** 재생을 시작합니다!")
        else:
            await interaction.edit_original_response(
                content=f"✅ **{track.title}** 이(가) 대기열 {pos}번에 추가되었습니다."
            )


class MusicView(discord.ui.View):
    def __init__(self, entries: list[dict], requester: discord.Member):
        super().__init__(timeout=30)
        self.add_item(MusicSelect(entries, requester))


class RemoveSelect(discord.ui.Select):
    MAX_OPTIONS = 25  # discord.ui.Select 자체 한도

    def __init__(self, queue: list, requester: discord.Member):
        self.queue = queue
        self.requester = requester
        options = [
            discord.SelectOption(
                label=t.title[:100],
                description=f"{t.uploader} • {format_duration(t.duration)}"[:100],
                value=str(i),
            )
            for i, t in enumerate(queue[:self.MAX_OPTIONS])
        ]
        placeholder = "제거할 곡을 선택하세요..."
        if len(queue) > self.MAX_OPTIONS:
            placeholder = f"제거할 곡을 선택하세요... (앞 {self.MAX_OPTIONS}곡만 표시)"
        super().__init__(placeholder=placeholder, options=options)

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
        cog: "Music" = interaction.client.cogs.get("Music")
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


class QueuePaginatorView(discord.ui.View):
    PAGE_SIZE = 10

    def __init__(self, queue: list[Track], requester_id: int):
        super().__init__(timeout=120)
        self.queue        = queue
        self.requester_id = requester_id
        self.page         = 0
        self.max_page     = max((len(queue) - 1) // self.PAGE_SIZE, 0)
        self._sync_buttons()

    def _sync_buttons(self):
        self.prev_button.disabled = self.page <= 0
        self.next_button.disabled = self.page >= self.max_page

    def build_embed(self) -> discord.Embed:
        start = self.page * self.PAGE_SIZE
        chunk = self.queue[start:start + self.PAGE_SIZE]
        lines = [
            f"`{start + i + 1}.` **{t.title}** — {t.uploader} · {t.duration_str}"
            for i, t in enumerate(chunk)
        ]
        embed = discord.Embed(
            title="📋 전체 대기열",
            description=f"총 {len(self.queue)}곡 · {self.page + 1}/{self.max_page + 1} 페이지\n\n" + "\n".join(lines),
            color=discord.Color.blue(),
        )
        return embed

    async def _turn(self, interaction: discord.Interaction, delta: int):
        if interaction.user.id != self.requester_id:
            await interaction.response.send_message(
                "명령어를 실행한 사람만 조작할 수 있습니다.", ephemeral=True
            )
            return
        self.page += delta
        self._sync_buttons()
        await interaction.response.edit_message(embed=self.build_embed(), view=self)

    @discord.ui.button(label="◀", style=discord.ButtonStyle.secondary)
    async def prev_button(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._turn(interaction, -1)

    @discord.ui.button(label="▶", style=discord.ButtonStyle.secondary)
    async def next_button(self, interaction: discord.Interaction, _button: discord.ui.Button):
        await self._turn(interaction, 1)


# ── 재생목록 ──────────────────────────────────────────────────────────

PLAYLIST_MAX = 50  # 재생목록 전체를 무제한으로 받으면 느리고 남용 소지가 있어 상한을 둔다.


async def extract_playlist(url: str, requester: discord.Member) -> tuple[list[Track], str, str]:
    """재생목록 URL에서 최대 PLAYLIST_MAX곡의 메타데이터만 가볍게 가져온다.
    (제목, 썸네일, 곡 목록) 반환. 각 곡의 실제 스트리밍 URL은 재생 직전에 해석된다."""
    loop = asyncio.get_running_loop()

    def _extract():
        opts = {**YTDL_SEARCH_OPTS, "playlistend": PLAYLIST_MAX}
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)

    data = await asyncio.wait_for(loop.run_in_executor(None, _extract), timeout=60)
    if not data or "entries" not in data:
        raise ValueError("재생목록 링크가 아닌 것 같습니다.")

    entries = [e for e in data.get("entries") or [] if e][:PLAYLIST_MAX]
    fallback_uploader = data.get("channel") or data.get("uploader") or "알 수 없음"

    tracks = []
    for e in entries:
        vid = e.get("id", "")
        tracks.append(Track({
            "title": e.get("title", "알 수 없는 제목"),
            "webpage_url": e.get("url") or (f"https://www.youtube.com/watch?v={vid}" if vid else ""),
            "duration": e.get("duration") or 0,
            "uploader": e.get("uploader") or e.get("channel") or fallback_uploader,
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else "",
        }, requester))

    title = data.get("title") or "재생목록"
    thumbs = data.get("thumbnails") or []
    thumbnail = thumbs[-1]["url"] if thumbs else (tracks[0].thumbnail if tracks else "")
    return tracks, title, thumbnail


async def load_playlist(cog: "Music", interaction: discord.Interaction, url: str):
    try:
        tracks, title, thumbnail = await extract_playlist(url, interaction.user)
    except asyncio.TimeoutError:
        await interaction.followup.send("⏱️ 재생목록을 불러오는 데 너무 오래 걸렸습니다. 다시 시도해주세요.", ephemeral=True)
        return
    except Exception as e:
        await interaction.followup.send(f"❌ 재생목록을 불러오지 못했습니다: {e}", ephemeral=True)
        return
    if not tracks:
        await interaction.followup.send("재생목록에서 곡을 찾지 못했습니다.", ephemeral=True)
        return

    vc: discord.VoiceClient | None = interaction.guild.voice_client
    if vc is None:
        await interaction.followup.send(
            "`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", ephemeral=True
        )
        return

    guild_id = interaction.guild.id
    cog.playlist_queues[guild_id] = tracks
    cog.playlist_current.pop(guild_id, None)
    cog.playlist_meta[guild_id] = {"title": title, "thumbnail": thumbnail, "total": len(tracks)}

    await cog.switch_mode(interaction.guild, "playlist")
    await cog.advance(interaction.guild, "playlist")

    note = f" (최대 {PLAYLIST_MAX}곡까지만)" if len(tracks) >= PLAYLIST_MAX else ""
    img = await render_playlist_card(
        cog.playlist_meta[guild_id],
        cog.playlist_current.get(guild_id),
        cog.playlist_queues.get(guild_id, []),
    )
    await interaction.followup.send(
        content=f"✅ **{title}**{note} 재생을 시작합니다 — 총 {len(tracks)}곡",
        file=discord.File(img, "playlist.png"),
        ephemeral=True,
    )


class PlaylistSearchModal(discord.ui.Modal, title="재생목록 불러오기"):
    url = discord.ui.TextInput(
        label="유튜브 재생목록 링크",
        placeholder="https://www.youtube.com/playlist?list=...",
        min_length=10, max_length=300,
    )

    def __init__(self, cog: "Music"):
        super().__init__()
        self.cog = cog

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        await load_playlist(self.cog, interaction, self.url.value.strip())


class PlaylistControlView(discord.ui.View):
    def __init__(self, cog: "Music"):
        super().__init__(timeout=120)
        self.cog = cog

    @discord.ui.button(label="▶️ 재생", style=discord.ButtonStyle.success)
    async def play(self, interaction: discord.Interaction, _button: discord.ui.Button):
        guild_id = interaction.guild.id
        vc: discord.VoiceClient | None = interaction.guild.voice_client
        if vc is None:
            await interaction.response.send_message(
                "`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", ephemeral=True
            )
            return

        meta = self.cog.playlist_meta.get(guild_id)
        has_queue = bool(self.cog.playlist_queues.get(guild_id)) or guild_id in self.cog.playlist_current

        if meta is None or not has_queue:
            # 로드된 재생목록이 없으면 링크를 입력받는 모달을 띄운다.
            await interaction.response.send_modal(PlaylistSearchModal(self.cog))
            return

        if self.cog.active_mode.get(guild_id) == "playlist" and (vc.is_playing() or vc.is_paused()):
            await interaction.response.send_message("이미 재생목록이 재생 중입니다.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        await self.cog.switch_mode(interaction.guild, "playlist")
        await self.cog.advance(interaction.guild, "playlist")

        img = await render_playlist_card(
            self.cog.playlist_meta.get(guild_id, meta),
            self.cog.playlist_current.get(guild_id),
            self.cog.playlist_queues.get(guild_id, []),
        )
        await interaction.followup.send(
            content=f"▶️ **{meta['title']}** 재생을 재개합니다.",
            file=discord.File(img, "playlist.png"),
            ephemeral=True,
        )

    @discord.ui.button(label="⏸️ 중지", style=discord.ButtonStyle.secondary)
    async def stop(self, interaction: discord.Interaction, _button: discord.ui.Button):
        guild_id = interaction.guild.id
        vc: discord.VoiceClient | None = interaction.guild.voice_client
        if vc is None or self.cog.active_mode.get(guild_id) != "playlist" or not vc.is_playing():
            if vc is not None and vc.is_paused() and self.cog.active_mode.get(guild_id) == "playlist":
                await interaction.response.send_message("이미 일시정지 상태입니다.", ephemeral=True)
            else:
                await interaction.response.send_message("재생 중인 재생목록이 없습니다.", ephemeral=True)
            return

        vc.pause()
        await interaction.response.send_message("⏸️ 재생목록을 일시정지했습니다.", ephemeral=True)

    @discord.ui.button(label="🗑️ 제거", style=discord.ButtonStyle.danger)
    async def remove(self, interaction: discord.Interaction, _button: discord.ui.Button):
        guild_id = interaction.guild.id
        if (
            guild_id not in self.cog.playlist_meta
            and not self.cog.playlist_queues.get(guild_id)
            and guild_id not in self.cog.playlist_current
        ):
            await interaction.response.send_message("불러온 재생목록이 없습니다.", ephemeral=True)
            return

        vc: discord.VoiceClient | None = interaction.guild.voice_client
        if self.cog.active_mode.get(guild_id) == "playlist" and vc is not None and (vc.is_playing() or vc.is_paused()):
            vc.stop()
            self.cog.active_mode.pop(guild_id, None)

        self.cog.playlist_queues.pop(guild_id, None)
        self.cog.playlist_current.pop(guild_id, None)
        self.cog.playlist_meta.pop(guild_id, None)
        await interaction.response.send_message("🗑️ 재생목록을 제거했습니다.", ephemeral=True)
