import asyncio
import discord
import wavelink
from discord.ext import commands

from bot.cogs.control import category_embed
from bot.cogs.music.renderer import render_queue_card, render_playlist_card
from bot.cogs.music.views import (
    Track,
    MusicSearchPromptView, RemoveView, QueuePaginatorView, PlaylistControlView,
)
from bot.cogs.util import GENERATING_MSG

# 원인 불명 버그(재생목록 로드 시 전체 트랙이 수백ms 안에 연쇄적으로 재생/종료됨)로 임시 차단.
# 재활성화하려면 False로. views.py의 PlaylistControlView 등 관련 코드는 그대로 남겨둠 — 이 명령어
# 진입점 하나만 막으면 재생목록 관련 View/버튼은 애초에 사용자에게 노출되지 않는다.
PLAYLIST_DISABLED = True
PLAYLIST_DISABLED_MSG = "🚧 재생목록 기능은 원인 불명 버그로 현재 일시적으로 사용할 수 없습니다."
MIN_RESUME_MS = 5000            # 마지막 재생 위치가 이 값 이상이면 이어 재생, 아니면 처음부터
STABLE_PLAYBACK_MS = 15000      # 이만큼 끊김 없이 재생되면 "복구됨"으로 보고 실패 체인/안내 메시지 초기화
RETRY_CHAIN_RESET_MS = STABLE_PLAYBACK_MS  # (구 이름 호환)
# 유튜브 연결 실패는 큐를 건너뛰지 않고 무한 재시도한다.
#   - 영구 재생불가로 분류된 곡(_fatal_tracks) 과 유저의 수동 !음악 스킵 만 예외.
#   - 재시도 간격은 백오프 (1→3→8→15→30초, 마지막 값에서 고정) — Lavalink/유튜브를 계속 때리지 않도록.
RETRY_DELAYS_SEC = [1, 3, 8, 15, 30]
NOTICE_LINGER_SEC = 6          # "재생 재개" 안내를 이 시간만 보여주고 삭제

# Lavalink TrackException 메시지를 실제 사유별로 분류 — 재시도 무의미한 "영구 재생불가"만 여기 걸린다.
# 클라이언트 자체 버그로 나는 메시지(예: TV 클라이언트의 "page needs to be reloaded")는 영상과 무관하게
# 뜨므로 절대 넣지 않는다 — 넣으면 멀쩡한 영상까지 오분류되어 건너뛰게 된다.
FATAL_MARKERS: list[tuple[str, tuple[str, ...]]] = [
    ("login",   ("requires login", "sign in to confirm", "confirm your age")),
    ("region",  ("not available in your country", "not available in your region")),
    ("removed", ("video unavailable", "video is no longer available", "video has been removed", "video is private")),
    ("blocked", ("playability status", "video player configuration error")),
]
FATAL_LABELS = {
    "login":   "연령제한/로그인이 필요한 영상이라",
    "region":  "지역 제한이 걸린 영상이라",
    "removed": "삭제되었거나 비공개 처리된 영상이라",
    "blocked": "유튜브에서 재생을 막아둔 영상이라",
}


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
        # guild_id -> "single" | "playlist": 지금 실제로 재생 중인 트랙이 어느 모드 소속인지.
        # on_wavelink_track_end 이벤트는 곡 하나당 한 번씩만 오고 "어느 모드였는지" 정보가
        # 없어서, advance()가 재생을 시작할 때 여기 기록해두고 이벤트 핸들러가 다시 읽는다.
        self._playing_mode: dict[int, str] = {}
        # guild_id -> Lock: 곡 종료 이벤트와 "대기 중이면 즉시 재생" 경로가 동시에
        # advance를 부르면 current가 실제 재생곡과 어긋날 수 있어 직렬화한다.
        self._advance_locks: dict[int, asyncio.Lock] = {}
        # guild_id -> True: !음악 스킵처럼 우리가 의도적으로 vc.stop()을 부른 경우 표시.
        # reason='stopped'가 "내가 스킵 눌러서" 인지 "원인불명으로 중단됨"인지 구분하는 용도.
        self._expected_stop: set[int] = set()
        # guild_id -> {track_key: retry_count}: 비정상 종료된 곡을 1회만 자동 재시도한다.
        self._retry_counts: dict[int, dict[str, int]] = {}
        # guild_id -> {track_key: position_ms}: 현재 곡의 마지막 재생 위치를 저장한다.
        self._last_positions: dict[int, dict[str, int]] = {}
        # guild_id -> {track_key: position_ms}: 다음 재시도에서 사용할 시작 위치를 저장한다.
        self._retry_starts: dict[int, dict[str, int]] = {}
        # guild_id -> Task: 비정상 종료/재생 실패 후 재복구를 예약한다.
        self._retry_tasks: dict[int, asyncio.Task] = {}
        # guild_id -> set[track_key]: 자동 복구 가치가 낮은 치명적 에러로 분류된 트랙.
        self._fatal_tracks: dict[int, dict[str, str]] = {}  # track_key -> 분류 사유(FATAL_LABELS 키)
        # guild_id -> discord.Message: "재시도 중" 안내 메시지 (길드당 딱 1개, 자리에서 갱신).
        self._retry_notices: dict[int, discord.Message] = {}
        # guild_id -> discord.abc.Messageable: 안내를 보낼 텍스트 채널. Player가 재생성돼도
        # 살아남도록 vc.home 과 별개로 여기에도 보관한다.
        self._home: dict[int, discord.abc.Messageable] = {}

    async def cog_unload(self):
        """Cog가 내려갈 때(핫리로드 포함) 호출된다. 여기서 정리하지 않으면
        재로드 후 새 Music 인스턴스는 텅 빈 상태로 시작하는데, 옛 인스턴스가 걸어둔
        상태는 여전히 백그라운드에 남아있게 된다 — 완전히 분리된 두 "뇌"가 동시에 존재하는 상태.
        그래서 언로드 시점에 모든 음성 연결을 확실히 끊는다."""
        for vc in list(self.bot.voice_clients):
            try:
                if vc.playing or vc.paused:
                    await vc.stop()
                await vc.disconnect(force=True)
            except Exception as e:
                print(f"[Music] cog_unload 중 음성 연결 정리 실패: {e}")

        for msg in list(self._retry_notices.values()):
            try:
                await msg.delete()
            except Exception:
                pass

        self.queues.clear()
        self.current.clear()
        self.playlist_queues.clear()
        self.playlist_current.clear()
        self.playlist_meta.clear()
        self.active_mode.clear()
        self._playing_mode.clear()
        self._retry_counts.clear()
        self._last_positions.clear()
        self._retry_starts.clear()
        self._fatal_tracks.clear()
        self._retry_notices.clear()
        self._home.clear()
        for task in self._retry_tasks.values():
            task.cancel()
        self._retry_tasks.clear()

    def _advance_lock(self, guild_id: int) -> asyncio.Lock:
        return self._advance_locks.setdefault(guild_id, asyncio.Lock())

    def _state(self, mode: str) -> tuple[dict, dict]:
        """mode에 해당하는 (큐 dict, 현재곡 dict) 쌍을 반환."""
        if mode == "playlist":
            return self.playlist_queues, self.playlist_current
        return self.queues, self.current

    def _clear_guild_state(self, guild_id: int):
        self.queues.pop(guild_id, None)
        self.current.pop(guild_id, None)
        self.playlist_queues.pop(guild_id, None)
        self.playlist_current.pop(guild_id, None)
        self.playlist_meta.pop(guild_id, None)
        self.active_mode.pop(guild_id, None)
        self._playing_mode.pop(guild_id, None)
        self._expected_stop.discard(guild_id)
        self._retry_counts.pop(guild_id, None)
        self._last_positions.pop(guild_id, None)
        self._retry_starts.pop(guild_id, None)
        self._fatal_tracks.pop(guild_id, None)
        self._retry_notices.pop(guild_id, None)  # 참조만 버림 — 메시지 삭제는 _dismiss_retry_notice 담당
        self._home.pop(guild_id, None)
        task = self._retry_tasks.pop(guild_id, None)
        if task is not None:
            task.cancel()

    def _track_key(self, track: Track) -> str:
        # 같은 유튜브 곡이라도 "나중에 새로 추가된 재생"은 새 체인으로 취급해야 하므로
        # 곡 메타데이터가 아니라 현재 런타임 Track 인스턴스 자체를 기준으로 본다.
        return str(id(track))

    def _clear_retry(self, guild_id: int, track: Track | None, *, clear_position: bool = False):
        if track is None:
            return
        retry_map = self._retry_counts.get(guild_id)
        if retry_map is None:
            retry_map = None
        else:
            retry_map.pop(self._track_key(track), None)
            if not retry_map:
                self._retry_counts.pop(guild_id, None)
        retry_start_map = self._retry_starts.get(guild_id)
        if retry_start_map is not None:
            retry_start_map.pop(self._track_key(track), None)
            if not retry_start_map:
                self._retry_starts.pop(guild_id, None)
        last_pos_map = self._last_positions.get(guild_id)
        if clear_position and last_pos_map is not None:
            last_pos_map.pop(self._track_key(track), None)
            if not last_pos_map:
                self._last_positions.pop(guild_id, None)
        fatal_map = self._fatal_tracks.get(guild_id)
        if fatal_map is not None:
            fatal_map.pop(self._track_key(track), None)
            if not fatal_map:
                self._fatal_tracks.pop(guild_id, None)

    def _consume_retry(self, guild_id: int, track: Track) -> int:
        retry_map = self._retry_counts.setdefault(guild_id, {})
        key = self._track_key(track)
        retry_map[key] = retry_map.get(key, 0) + 1
        return retry_map[key]

    def _get_last_position(self, guild_id: int, track: Track | None) -> int:
        if track is None:
            return 0
        return self._last_positions.get(guild_id, {}).get(self._track_key(track), 0)

    def _mark_fatal(self, guild_id: int, track: Track, category: str):
        self._fatal_tracks.setdefault(guild_id, {})[self._track_key(track)] = category

    def _is_fatal(self, guild_id: int, track: Track | None) -> bool:
        if track is None:
            return False
        return self._track_key(track) in self._fatal_tracks.get(guild_id, {})

    def _fatal_label(self, guild_id: int, track: Track | None) -> str:
        """스킵 안내에 쓸 사람이 읽을 사유. '~영상이라' 로 끝나서 문장에 그대로 붙는다."""
        category = None
        if track is not None:
            category = self._fatal_tracks.get(guild_id, {}).get(self._track_key(track))
        return FATAL_LABELS.get(category, "재생할 수 없는 영상이라")

    def _classify_fatal(self, message: str, cause: str) -> str | None:
        """Lavalink TrackException 메시지를 실제 사유별로 분류한다. 매칭 안 되면 None(=일시적, 재시도 대상)."""
        haystack = f"{message}\n{cause}".lower()
        for category, markers in FATAL_MARKERS:
            if any(marker in haystack for marker in markers):
                return category
        return None

    def _retry_delay(self, attempt: int) -> float:
        """재시도 횟수(1부터)에 따른 백오프 대기(초). 마지막 값에서 고정."""
        idx = min(max(attempt, 1) - 1, len(RETRY_DELAYS_SEC) - 1)
        return RETRY_DELAYS_SEC[idx]

    def _home_channel(self, guild: discord.Guild) -> "discord.abc.Messageable | None":
        vc = guild.voice_client
        return self._home.get(guild.id) or getattr(vc, "home", None)

    async def _show_retry_notice(self, guild: discord.Guild, track: Track, attempt: int, delay: float):
        """'재시도 중' 안내를 길드당 한 개만 유지하며 자리에서 갱신한다."""
        home = self._home_channel(guild)
        if home is None:
            return
        text = (
            f"🔄 유튜브 연결이 불안정합니다 — **{track.title}** 재생을 다시 시도하고 있어요.\n"
            f"⏳ {int(delay)}초 후 재시도 (총 {attempt}회째) · 연결되면 끊긴 지점부터 자동으로 이어서 재생됩니다."
        )
        msg = self._retry_notices.get(guild.id)
        try:
            if msg is None:
                self._retry_notices[guild.id] = await home.send(text)
            else:
                await msg.edit(content=text)
        except discord.HTTPException:
            self._retry_notices.pop(guild.id, None)

    async def _dismiss_retry_notice(self, guild_id: int, *, resumed_title: str | None = None):
        """재시도 안내를 없앤다. resumed_title 이 있으면 '재개' 문구로 잠깐 바꿨다가 삭제."""
        msg = self._retry_notices.pop(guild_id, None)
        if msg is None:
            return
        try:
            if resumed_title:
                await msg.edit(content=f"▶️ 연결이 복구되어 **{resumed_title}** 재생을 이어갑니다.")
                await asyncio.sleep(NOTICE_LINGER_SEC)
            await msg.delete()
        except discord.HTTPException:
            pass

    async def _notify_skip(self, guild: discord.Guild, title: str, why: str):
        home = self._home_channel(guild)
        if home is None:
            return
        try:
            await home.send(f"⚠️ **{title}** 은(는) {why} 다음 곡으로 넘어갑니다.")
        except discord.HTTPException:
            pass

    def _schedule_retry(self, guild: discord.Guild, mode: str, track: Track, *, start: int, reason: str, attempt: int = 1):
        guild_id = guild.id
        queues, currents = self._state(mode)
        currents.pop(guild_id, None)
        queue = queues.setdefault(guild_id, [])
        if not queue or queue[0] is not track:
            queue.insert(0, track)
        self._retry_starts.setdefault(guild_id, {})[self._track_key(track)] = start

        existing = self._retry_tasks.pop(guild_id, None)
        if existing is not None:
            existing.cancel()

        delay = self._retry_delay(attempt)
        self.bot.loop.create_task(self._show_retry_notice(guild, track, attempt, delay))

        async def _runner():
            try:
                await asyncio.sleep(delay)
                await self.advance(guild, mode)
            except asyncio.CancelledError:
                return
            finally:
                current_task = self._retry_tasks.get(guild_id)
                if current_task is asyncio.current_task():
                    self._retry_tasks.pop(guild_id, None)

        self._retry_tasks[guild_id] = self.bot.loop.create_task(_runner())
        print(
            f"[Music] 자동 복구 예약: '{track.title}' reason={reason} attempt={attempt} start={start}ms delay={delay}s",
            flush=True,
        )

    async def switch_mode(self, guild: discord.Guild, mode: str):
        """반대 모드가 재생/일시정지 중이면 멈추고 이 모드로 전환한다.
        멈춘 트랙은 잃어버리지 않도록 그 모드의 큐 맨 앞으로 되돌려 놓는다
        (다만 오디오 소스 자체는 다시 만들어야 해서 재개 시 처음부터 다시 재생됨)."""
        vc: wavelink.Player | None = guild.voice_client
        guild_id = guild.id
        old_mode = self.active_mode.get(guild_id)

        if old_mode is not None and old_mode != mode:
            # 이전 모드가 유튜브 재시도 대기 중이었다면 그 타이머와 안내를 정리한다
            # (트랙 자체는 아래에서 이전 모드 큐 맨 앞에 보존되므로 잃어버리지 않는다).
            rt = self._retry_tasks.pop(guild_id, None)
            if rt is not None:
                rt.cancel()
            await self._dismiss_retry_notice(guild_id)

            # _playing_mode 판단이 어떤 이유로든 어긋나 있어도 대기열을 잃어버리면 안 되니,
            # "재생 중이라고 믿는지"와 무관하게 이전 모드의 current는 항상 큐 맨 앞으로 되돌린다.
            old_queue, old_current = self._state(old_mode)
            interrupted = old_current.pop(guild_id, None)
            if interrupted is not None:
                old_queue.setdefault(guild_id, []).insert(0, interrupted)

            if vc is not None and self._playing_mode.get(guild_id) is not None:
                await vc.stop()  # on_wavelink_track_end이 old_mode로 advance를 다시 부르지만, active_mode가 이미 바뀌어 있어 아무 것도 안 함
            # wavelink의 vc.playing/paused는 stop() 직후에도 잠깐 stale하게 True로 남는다
            # (공식 문서에 명시된 동작) — 그래서 "재생 중인지"는 이 딕셔너리로 직접 관리한다.
            self._playing_mode.pop(guild_id, None)

        self.active_mode[guild_id] = mode

    async def advance(self, guild: discord.Guild, mode: str):
        async with self._advance_lock(guild.id):
            vc: wavelink.Player | None = guild.voice_client
            if vc is None:
                return

            # 이 모드가 더 이상 활성 모드가 아니면(반대 모드가 선점함) 아무 것도 하지 않는다.
            if self.active_mode.get(guild.id) != mode:
                return

            # 락을 기다리는 동안 다른 경로가 이미 다음 곡을 재생 시작했을 수 있다 — 중복 재생 방지.
            # vc.playing/paused 대신 우리가 직접 관리하는 _playing_mode를 쓴다 — wavelink의
            # 프로퍼티는 stop() 직후 잠깐 stale하게 남아서 신뢰할 수 없다.
            if self._playing_mode.get(guild.id) is not None:
                return

            queues, currents = self._state(mode)
            queue = queues.get(guild.id, [])

            while queue:
                track = queue.pop(0)
                currents[guild.id] = track
                self._playing_mode[guild.id] = mode
                track_key = self._track_key(track)
                start = self._retry_starts.get(guild.id, {}).pop(track_key, 0)

                try:
                    await vc.play(track.playable, start=start)
                except Exception as e:
                    # vc.play() 실패 = 이 시점에 유튜브 연결/클라이언트 폴백체인이 안 되는 상태.
                    # 예전엔 LavalinkException이면 "폴백 다 실패 = 무의미"라며 즉시 스킵했는데,
                    # 유튜브가 일시적으로 맛이 가면 '모든 영상'이 이렇게 실패해서 큐 전체가 순식간에
                    # 스킵돼 버렸다. 그래서 이제는 스킵하지 않고 무한 재시도한다 —
                    # 영구 재생불가로 분류된 곡(_is_fatal)만 예외.
                    self._playing_mode.pop(guild.id, None)
                    currents.pop(guild.id, None)

                    if self._is_fatal(guild.id, track):
                        reason = self._fatal_label(guild.id, track)
                        print(f"[Music] 재생 불가로 건너뜀: '{track.title}' ({e!r})", flush=True)
                        self._clear_retry(guild.id, track, clear_position=True)
                        self.bot.loop.create_task(self._notify_skip(guild, track.title, reason))
                        continue

                    retry_no = self._consume_retry(guild.id, track)
                    print(f"[Music] '{track.title}' 재생 준비 실패 — 재시도 예약: {e!r}", flush=True)
                    self._schedule_retry(guild, mode, track, start=start, reason="play_failed", attempt=retry_no)
                    return

                # 재생 시작 성공 — 재시도 안내가 떠 있었으면 정리한다.
                if start > 0:
                    print(f"[Music] 이어 재생 복구 성공: '{track.title}' start={start}ms", flush=True)
                if guild.id in self._retry_notices:
                    self.bot.loop.create_task(self._dismiss_retry_notice(guild.id, resumed_title=track.title))
                return

            currents.pop(guild.id, None)
            self._playing_mode.pop(guild.id, None)
            if mode == "playlist":
                self.playlist_meta.pop(guild.id, None)
            if self.active_mode.get(guild.id) == mode:
                self.active_mode.pop(guild.id, None)

    @commands.Cog.listener()
    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload):
        player = payload.player
        if player is None or player.guild is None:
            return
        guild_id = player.guild.id
        mode = self._playing_mode.get(guild_id)
        if mode is None:
            return

        _, currents = self._state(mode)
        current = currents.get(guild_id)
        # 정상 종료(finished)도 아니고 우리가 !음악 스킵으로 의도한 stop도 아닌 경우만 남긴다
        # (스트림 끊김/스터크/에러 등 — "가끔 강제스킵되는 것 같다"는 증상의 진짜 원인 파악용).
        was_expected = guild_id in self._expected_stop
        self._expected_stop.discard(guild_id)
        self._playing_mode.pop(guild_id, None)

        if payload.reason == "finished" or was_expected:
            self._clear_retry(guild_id, current, clear_position=True)
            self.bot.loop.create_task(self._dismiss_retry_notice(guild_id))
            await self.advance(player.guild, mode)
            return

        title = current.title if current is not None else payload.track.title
        print(f"[Music] 비정상 종료: '{title}' reason={payload.reason!r}", flush=True)

        if current is None:
            await self.advance(player.guild, mode)
            return

        if self._is_fatal(guild_id, current):
            # 영구 재생불가(로그인 필요 등) — 무한 재시도해봐야 소용없으니 건너뛴다.
            reason = self._fatal_label(guild_id, current)
            queues, currents = self._state(mode)
            currents.pop(guild_id, None)
            self._clear_retry(guild_id, current, clear_position=True)
            print(f"[Music] 재생 불가로 건너뜀: '{title}' reason={reason}", flush=True)
            self.bot.loop.create_task(self._notify_skip(player.guild, title, reason))
            await self.advance(player.guild, mode)
            return

        retry_no = self._consume_retry(guild_id, current)
        last_position = self._get_last_position(guild_id, current)
        resume_from = last_position if last_position >= MIN_RESUME_MS else 0
        print(
            f"[Music] 비정상 종료 — 재시도 예약(무한): '{title}' attempt={retry_no} resume_from={resume_from}ms",
            flush=True,
        )
        self._schedule_retry(
            player.guild, mode, current, start=resume_from,
            reason=f"track_end_{payload.reason}", attempt=retry_no,
        )

    @commands.Cog.listener()
    async def on_wavelink_player_update(self, payload: wavelink.PlayerUpdateEventPayload):
        player = payload.player
        if player is None or player.guild is None:
            return

        guild_id = player.guild.id
        mode = self._playing_mode.get(guild_id)
        if mode is None:
            return

        _, currents = self._state(mode)
        current = currents.get(guild_id)
        if current is None:
            return

        track_key = self._track_key(current)
        self._last_positions.setdefault(guild_id, {})[track_key] = payload.position

        retry_count = self._retry_counts.get(guild_id, {}).get(track_key)
        retry_start = self._retry_starts.get(guild_id, {}).get(track_key, 0)
        if retry_count and payload.position >= retry_start + STABLE_PLAYBACK_MS:
            print(
                f"[Music] 재생 안정화로 실패 체인 초기화: '{current.title}' position={payload.position}ms",
                flush=True,
            )
            self._clear_retry(guild_id, current, clear_position=False)
            if guild_id in self._retry_notices:
                self.bot.loop.create_task(self._dismiss_retry_notice(guild_id, resumed_title=current.title))

    @commands.Cog.listener()
    async def on_wavelink_track_exception(self, payload: wavelink.TrackExceptionEventPayload):
        player = payload.player
        if player is None or player.guild is None:
            return

        guild_id = player.guild.id
        mode = self._playing_mode.get(guild_id)
        if mode is None:
            return

        _, currents = self._state(mode)
        current = currents.get(guild_id)
        if current is None:
            return

        message = payload.exception.get("message", "")
        cause = payload.exception.get("cause", "")
        severity = payload.exception.get("severity", "")
        print(
            f"[Music] TrackException: '{current.title}' severity={severity} message={message!r} cause={cause!r}",
            flush=True,
        )

        category = self._classify_fatal(message, cause)
        if category is not None:
            self._mark_fatal(guild_id, current, category)
            print(f"[Music] 치명적 재생 불가로 분류: '{current.title}' category={category}", flush=True)

    @commands.Cog.listener()
    async def on_wavelink_inactive_player(self, player: wavelink.Player):
        """wavelink가 자체적으로 추적한다 — 곡이 끝난 뒤(또는 애초에 아무것도 안 튼 채)
        Node의 inactive_player_timeout(기본 300초) 동안 새로 재생을 시작하지 않으면 발생.
        직접 타이머를 만들 필요 없이 이 이벤트에 맞춰 퇴장 + 상태 정리만 하면 된다."""
        guild = player.guild
        if guild is None:
            return

        home = self._home_channel(guild)
        await player.disconnect()
        await self._dismiss_retry_notice(guild.id)
        self._clear_guild_state(guild.id)

        if home is not None:
            try:
                await home.send("⏰ 5분간 재생 활동이 없어 음성 채널에서 자동 퇴장했습니다.")
            except Exception:
                pass

    @commands.group(name="음악", invoke_without_command=True)
    async def music_group(self, ctx: commands.Context):
        await ctx.reply(embed=category_embed("music", ctx.clean_prefix), mention_author=False)

    @music_group.command(name="입장")
    async def join(self, ctx: commands.Context):
        """봇을 현재 음성 채널에 입장시킵니다."""
        if ctx.author.voice is None:
            await ctx.reply("먼저 음성 채널에 입장하세요!", mention_author=False)
            return

        channel = ctx.author.voice.channel
        vc: wavelink.Player | None = ctx.voice_client

        if vc is not None:
            if vc.channel == channel:
                await ctx.reply("이미 해당 음성 채널에 있습니다.", mention_author=False)
                return
            await vc.move_to(channel)
        else:
            vc = await channel.connect(cls=wavelink.Player)

        vc.home = ctx.channel  # 자동 퇴장 안내를 보낼 텍스트 채널 기억
        self._home[ctx.guild.id] = ctx.channel  # 재시도 안내도 여기로

        await ctx.reply(f"🎙️ **{channel.name}** 채널에 입장했습니다.", mention_author=False)

    @music_group.command(name="퇴장")
    async def leave(self, ctx: commands.Context):
        """봇을 음성 채널에서 퇴장시키고 대기열/재생목록 상태를 전부 초기화합니다."""
        vc: wavelink.Player | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        await vc.disconnect()
        await self._dismiss_retry_notice(ctx.guild.id)
        self._clear_guild_state(ctx.guild.id)

        await ctx.reply("👋 음성 채널에서 퇴장했습니다.", mention_author=False)

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
        vc: wavelink.Player | None = ctx.voice_client
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
        vc: wavelink.Player | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        current = self.current.get(ctx.guild.id)
        queue = self.queues.get(ctx.guild.id, [])

        if current is None and not queue:
            await ctx.reply("현재 대기열이 비어있습니다.", mention_author=False)
            return

        msg = await ctx.reply(GENERATING_MSG, mention_author=False)
        img = await render_queue_card(current, queue)
        await msg.edit(content=None, attachments=[discord.File(img, "queue.png")])

    @music_group.command(name="대기목록")
    async def queue_list(self, ctx: commands.Context):
        """대기열 전체를 페이지네이션 임베드로 보여줍니다."""
        vc: wavelink.Player | None = ctx.voice_client
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
        vc: wavelink.Player | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return
        if self.active_mode.get(ctx.guild.id) != "single":
            await ctx.reply(
                "현재 재생 중인 일반 음악이 없습니다. (재생목록은 `!음악 플레이리스트`로 제어)",
                mention_author=False,
            )
            return
        if vc.paused:
            await ctx.reply("이미 일시정지 상태입니다.", mention_author=False)
            return
        if not vc.playing:
            await ctx.reply("현재 재생 중인 곡이 없습니다.", mention_author=False)
            return

        await vc.pause(True)
        await ctx.reply("⏸️ 일시정지했습니다. `!음악 재생` 으로 재개할 수 있습니다.", mention_author=False)

    @music_group.command(name="재생")
    async def resume(self, ctx: commands.Context):
        """일반 대기열의 음악을 재생/재개합니다. 재생목록이 재생 중이었다면 멈추고(트랙 보존)
        일반 대기열로 전환합니다 — `!음악 정지`/`!음악 재생`은 항상 일반 대기열 전용입니다."""
        vc: wavelink.Player | None = ctx.voice_client
        if vc is None:
            await ctx.reply("봇이 음성 채널에 연결되어 있지 않습니다.", mention_author=False)
            return

        guild_id = ctx.guild.id
        if self.active_mode.get(guild_id) == "single":
            # paused를 playing보다 먼저 체크해야 한다 — wavelink는 일시정지 중에도
            # 곡이 로드돼 있으면 playing이 True다 (paused 상태도 "playing"으로 침).
            # 순서가 바뀌면 정지 후 재생이 "이미 재생 중"으로 잘못 걸려 영영 재개가 안 된다.
            if vc.paused:
                await vc.pause(False)
                await ctx.reply("▶️ 재생을 재개합니다.", mention_author=False)
                return
            if vc.playing:
                await ctx.reply("이미 재생 중입니다.", mention_author=False)
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
        """현재 재생 중인 곡을 건너뜁니다 (유튜브 연결 실패로 재시도 대기 중인 곡도 포함)."""
        vc: wavelink.Player | None = ctx.voice_client
        guild_id = ctx.guild.id
        mode = self.active_mode.get(guild_id, "single")

        # 유튜브 연결 실패로 재시도 대기 중이면 — 그 곡을 포기하고 다음 곡으로.
        retry_task = self._retry_tasks.get(guild_id)
        if vc is not None and retry_task is not None and not vc.playing:
            retry_task.cancel()
            self._retry_tasks.pop(guild_id, None)
            queues, _ = self._state(mode)
            queue = queues.get(guild_id, [])
            skipped = queue.pop(0) if queue else None
            if skipped is not None:
                self._clear_retry(guild_id, skipped, clear_position=True)
            await self._dismiss_retry_notice(guild_id)
            await ctx.reply(
                f"⏭️ **{skipped.title if skipped else '곡'}** (재시도 중이던 곡) 을(를) 건너뜁니다.",
                mention_author=False,
            )
            await self.advance(ctx.guild, mode)
            return

        if vc is None or not vc.playing:
            await ctx.reply("현재 재생 중인 곡이 없습니다.", mention_author=False)
            return

        _, currents = self._state(mode)
        current = currents.get(guild_id)
        self._expected_stop.add(guild_id)
        await vc.stop()  # on_wavelink_track_end이 자동으로 advance 호출
        await ctx.reply(
            f"⏭️ **{current.title if current else '곡'}** 을(를) 건너뜁니다.",
            mention_author=False,
        )

    @music_group.command(name="플레이리스트")
    async def playlist(self, ctx: commands.Context):
        """재생목록을 재생/제거/중지 버튼으로 관리합니다."""
        if PLAYLIST_DISABLED:
            await ctx.reply(PLAYLIST_DISABLED_MSG, mention_author=False)
            return

        vc: wavelink.Player | None = ctx.voice_client
        if vc is None:
            await ctx.reply("`!음악 입장` 명령어로 봇을 음성 채널에 먼저 입장시켜주세요.", mention_author=False)
            return

        guild_id = ctx.guild.id
        meta = self.playlist_meta.get(guild_id)
        current = self.playlist_current.get(guild_id)
        queue = self.playlist_queues.get(guild_id, [])
        view = PlaylistControlView(self)

        is_active_now = self.active_mode.get(guild_id) == "playlist" and (vc.playing or vc.paused)

        if meta and is_active_now:
            msg = await ctx.reply(GENERATING_MSG, mention_author=False)
            img = await render_playlist_card(meta, current, queue)
            await msg.edit(content=None, attachments=[discord.File(img, "playlist.png")], view=view)
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
