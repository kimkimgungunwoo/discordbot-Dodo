from __future__ import annotations
import discord
import wavelink
from typing import TYPE_CHECKING

from bot.cogs.music.renderer import render_playlist_card

if TYPE_CHECKING:
    from bot.cogs.music import Music


def format_duration(seconds) -> str:
    seconds = int(seconds or 0)
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


class Track:
    """wavelink.Playable를 감싸는 얇은 래퍼.
    title/uploader/thumbnail/duration_str 인터페이스를 유지해서 renderer.py/HTML 템플릿을
    그대로 재사용한다. wavelink.Playable은 검색 시점에 이미 재생 가능한 상태라
    (구 yt-dlp 버전처럼) 재생 직전 별도 resolve() 단계가 필요없다."""
    def __init__(self, playable: wavelink.Playable, requester: discord.Member):
        self.playable = playable
        self.requester = requester

    def __str__(self) -> str:
        return self.title

    @property
    def title(self) -> str:
        return self.playable.title or "알 수 없는 제목"

    @property
    def uploader(self) -> str:
        return self.playable.author or "알 수 없음"

    @property
    def thumbnail(self) -> str:
        return self.playable.artwork or ""

    @property
    def duration_str(self) -> str:
        return format_duration((self.playable.length or 0) // 1000)


async def search_youtube(query: str, count: int = 10) -> list[wavelink.Playable]:
    """유튜브에서 count개의 검색 결과를 반환. 이미 재생 가능한 완전한 Playable들이라
    선택 시점에 추가 네트워크 호출이 필요없다.
    source는 기본값(YouTubeMusic/ytmsearch:)이 아니라 명시적으로 YouTube(ytsearch:)를 쓴다 —
    지금 설정된 클라이언트 조합(TV/WEB/ANDROID_VR 등)에서 ytmsearch:는 항상 빈 결과를 준다."""
    results = await wavelink.Playable.search(query, source=wavelink.TrackSource.YouTube)
    tracks = results.tracks if isinstance(results, wavelink.Playlist) else results
    return list(tracks[:count])


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
        dur = format_duration((e.length or 0) // 1000)
        embed.add_field(
            name=f"{i}. {(e.title or '제목 없음')[:50]}",
            value=f"{e.author or '알 수 없음'} • {dur}",
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
    def __init__(self, entries: list[wavelink.Playable], requester: discord.Member):
        self.entries = entries
        self.requester = requester
        options = []
        for i, e in enumerate(entries):
            dur = format_duration((e.length or 0) // 1000)
            options.append(
                discord.SelectOption(
                    label=(e.title or "제목 없음")[:100],
                    description=f"{e.author or '알 수 없음'} • {dur}"[:100],
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

        vc: wavelink.Player | None = interaction.guild.voice_client
        if vc is None:
            await interaction.edit_original_response(
                content="`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요."
            )
            return

        track = Track(self.entries[int(self.values[0])], interaction.user)

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
    def __init__(self, entries: list[wavelink.Playable], requester: discord.Member):
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
                description=f"{t.uploader} • {t.duration_str}"[:100],
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
    """재생목록 URL에서 최대 PLAYLIST_MAX곡을 가져온다. (제목, 썸네일, 곡 목록) 반환."""
    result = await wavelink.Playable.search(url)
    if not isinstance(result, wavelink.Playlist):
        raise ValueError("재생목록 링크가 아닌 것 같습니다.")

    tracks = [Track(p, requester) for p in list(result.tracks[:PLAYLIST_MAX])]
    title = result.name or "재생목록"
    thumbnail = result.artwork or (tracks[0].thumbnail if tracks else "")
    return tracks, title, thumbnail


async def load_playlist(cog: "Music", interaction: discord.Interaction, url: str):
    try:
        tracks, title, thumbnail = await extract_playlist(url, interaction.user)
    except Exception as e:
        await interaction.followup.send(f"❌ 재생목록을 불러오지 못했습니다: {e}", ephemeral=True)
        return
    if not tracks:
        await interaction.followup.send("재생목록에서 곡을 찾지 못했습니다.", ephemeral=True)
        return

    vc: wavelink.Player | None = interaction.guild.voice_client
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
        vc: wavelink.Player | None = interaction.guild.voice_client
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

        # paused를 playing보다 먼저 체크 — wavelink는 일시정지 중에도 곡이 로드돼 있으면
        # playing이 True라서, 순서가 바뀌면 일시정지된 재생목록을 다시 재생 눌러도
        # "이미 재생 중"으로 잘못 걸려서 영영 재개가 안 된다.
        if self.cog.active_mode.get(guild_id) == "playlist" and vc.paused:
            await vc.pause(False)
            await interaction.response.send_message("▶️ 재생목록을 재개합니다.", ephemeral=True)
            return

        if self.cog.active_mode.get(guild_id) == "playlist" and vc.playing:
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
        vc: wavelink.Player | None = interaction.guild.voice_client
        if vc is None or self.cog.active_mode.get(guild_id) != "playlist" or not vc.playing:
            if vc is not None and vc.paused and self.cog.active_mode.get(guild_id) == "playlist":
                await interaction.response.send_message("이미 일시정지 상태입니다.", ephemeral=True)
            else:
                await interaction.response.send_message("재생 중인 재생목록이 없습니다.", ephemeral=True)
            return

        await vc.pause(True)
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

        vc: wavelink.Player | None = interaction.guild.voice_client
        if self.cog.active_mode.get(guild_id) == "playlist" and vc is not None and (vc.playing or vc.paused):
            await vc.stop()
            self.cog.active_mode.pop(guild_id, None)
            # 이걸 안 지우면 advance()가 이후 계속 "재생 중"이라고 착각해서
            # 일반 재생이든 재생목록이든 아무것도 새로 안 틀리는 상태가 된다.
            self.cog._playing_mode.pop(guild_id, None)

        self.cog.playlist_queues.pop(guild_id, None)
        self.cog.playlist_current.pop(guild_id, None)
        self.cog.playlist_meta.pop(guild_id, None)
        await interaction.response.send_message("🗑️ 재생목록을 제거했습니다.", ephemeral=True)
