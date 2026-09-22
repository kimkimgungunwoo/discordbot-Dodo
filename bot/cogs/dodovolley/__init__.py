from __future__ import annotations

import asyncio
import hmac
import logging
import os
import uuid

import aiohttp
from aiohttp import web
import discord
from discord.ext import commands

log = logging.getLogger(__name__)


DIFFICULTIES = {"easy": "쉬움", "normal": "보통", "hard": "어려움", "extreme": "극한"}
# activity/client의 game/constants.ts WIN_SCORE와 반드시 같은 값이어야 한다.
WIN_SCORE = 7


class ModeView(discord.ui.View):
    def __init__(self, cog, ctx):
        super().__init__(timeout=180)
        self.cog, self.ctx = cog, ctx
        self.selection_lock = asyncio.Lock()
        self.selected = False
        self.message = None

    def stop(self):
        self.cog.selection_views.discard(self)
        super().stop()

    async def interaction_check(self, interaction):
        if interaction.user.id != self.ctx.author.id:
            await interaction.response.send_message("명령어를 입력한 사람만 선택할 수 있습니다.", ephemeral=True)
            return False
        return True

    async def on_timeout(self):
        self.cog.selection_views.discard(self)
        for item in self.children:
            item.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass

    @discord.ui.button(label="봇전", style=discord.ButtonStyle.primary)
    async def cpu(self, interaction, button):
        async with self.selection_lock:
            if self.selected:
                await interaction.response.send_message("이미 선택한 메뉴입니다.", ephemeral=True)
                return
            self.clear_items()
            for difficulty, label in DIFFICULTIES.items():
                item = discord.ui.Button(label=label, style=discord.ButtonStyle.primary)
                async def choose(event, difficulty=difficulty):
                    await self.choose(event, "CPU", difficulty)
                item.callback = choose
                self.add_item(item)
            await interaction.response.edit_message(
                embed=discord.Embed(title="도도새배구 · 봇전", description="난이도를 선택해주세요."), view=self)

    @discord.ui.button(label="대결", style=discord.ButtonStyle.success)
    async def pvp(self, interaction, button):
        await self.choose(interaction, "PVP")

    async def choose(self, interaction, mode, difficulty="normal"):
        await interaction.response.defer(ephemeral=True)
        async with self.selection_lock:
            if self.selected:
                await interaction.followup.send("이미 선택한 메뉴입니다.", ephemeral=True)
                return
            room = await self.cog.create_room(self.ctx, mode=mode, difficulty=difficulty)
            if room is None:
                await interaction.followup.send("방을 만들지 못했습니다. 채널의 안내를 확인해주세요.", ephemeral=True)
                return
            self.selected = True
            self.stop()
            try:
                await interaction.message.edit(view=None)
            except discord.HTTPException:
                log.warning("Could not remove Dodo mode selection buttons")
        if mode == "CPU":
            await interaction.followup.send("게임을 시작했습니다. 위 방 메시지의 [배구 하러 가기] 버튼으로 들어오세요.", ephemeral=True)
        else:
            await interaction.followup.send("대결 방을 만들었습니다. 상대 참가 후 시작해주세요.", ephemeral=True)


class LobbyView(discord.ui.View):
    def __init__(self, cog: "DodoVolley", room_id: str, playing: bool = False):
        super().__init__(timeout=None)
        self.cog = cog
        self.room_id = room_id
        if cog.rooms.get(room_id, {}).get("mode") == "CPU":
            for item in list(self.children):
                if item.custom_id in ("dodo:join", "dodo:cancel"):
                    self.remove_item(item)
        if playing:
            # PLAYING 중엔 참가/참가취소/게임시작만 숨김 — 방장이 꼬인 경기를 강제로 닫을 수 있게
            # 관전(dodo:spectate)/방닫기(dodo:close)는 그대로 남겨두고, 이 메시지를 보는 모두가
            # (2P 포함) 직접 들어올 수 있게 일반 링크 버튼을 추가한다.
            # Discord Activity(launch_activity)가 아니라 그냥 웹사이트 링크라 팀/테스터 제한이 없다.
            for item in list(self.children):
                if item.custom_id not in ("dodo:spectate", "dodo:close"):
                    self.remove_item(item)
            self.add_item(discord.ui.Button(
                label="배구 하러 가기", style=discord.ButtonStyle.link,
                url=f"{cog.public_url}/?room={room_id}",
            ))

    @discord.ui.button(label="참가", style=discord.ButtonStyle.success, custom_id="dodo:join")
    async def join(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.action(self.room_id, "join", interaction)

    @discord.ui.button(label="참가 취소", style=discord.ButtonStyle.secondary, custom_id="dodo:cancel")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.action(self.room_id, "cancel", interaction)

    @discord.ui.button(label="관전", style=discord.ButtonStyle.secondary, custom_id="dodo:spectate")
    async def spectate(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.action(self.room_id, "spectate", interaction)

    @discord.ui.button(label="게임 시작", style=discord.ButtonStyle.primary, custom_id="dodo:start")
    async def start_game(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.action(self.room_id, "start", interaction)

    @discord.ui.button(label="방 닫기", style=discord.ButtonStyle.danger, custom_id="dodo:close")
    async def close_room(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.action(self.room_id, "close", interaction)


class DodoVolley(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.rooms: dict[str, dict] = {}
        self.room_tasks: dict[str, asyncio.Task] = {}
        self.views: dict[str, LobbyView] = {}
        self.selection_views: set[ModeView] = set()
        # 길드별로 잠금을 나눠서 한 길드의 느린 네트워크 호출이 다른 길드의 방 조작까지 막지 않게 한다.
        self.locks: dict[str, asyncio.Lock] = {}
        self.runner: web.AppRunner | None = None
        self.http: aiohttp.ClientSession | None = None
        self.secret = os.getenv("ACTIVITY_INTERNAL_SECRET", "")
        self.server_url = os.getenv("ACTIVITY_SERVER_URL", "").rstrip("/")
        # 링크 버튼에 쓰는 공개 주소 — activity-server 내부 주소(server_url)와 다름(컨테이너 네트워크 vs 실제 도메인).
        self.public_url = os.getenv("ACTIVITY_PUBLIC_URL", "").rstrip("/")

    async def cog_load(self):
        self.http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8))
        app = web.Application(client_max_size=8192)
        app.router.add_post("/internal/game-results", self.game_result)
        app.router.add_post("/internal/game-rematches", self.game_rematch)
        # 재시작하면 self.rooms가 비어 재시작 전 메시지의 방은 전부 만료 처리되지만,
        # 그 메시지의 버튼이 "interaction failed"로 조용히 죽는 대신 이 fallback view가
        # 받아서 action()의 기존 "종료된 방입니다" 응답을 내보내게 한다.
        self.bot.add_view(LobbyView(self, "", playing=False))
        self.bot.add_view(LobbyView(self, "", playing=True))
        self.runner = web.AppRunner(app)
        try:
            await self.runner.setup()
            await web.TCPSite(
                self.runner, os.getenv("BOT_INTERNAL_HOST", "0.0.0.0"),
                int(os.getenv("BOT_INTERNAL_PORT", "3002")),
            ).start()
        except Exception:
            await self.runner.cleanup()
            await self.http.close()
            raise

    async def cog_unload(self):
        tasks = list(self.room_tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for view in list(self.selection_views):
            view.stop()
        for view in self.views.values():
            view.stop()
        self.views.clear()
        self.room_tasks.clear()
        self.rooms.clear()
        if self.runner:
            await self.runner.cleanup()
        if self.http:
            await self.http.close()

    def _lock_for(self, guild_id) -> asyncio.Lock:
        key = str(guild_id)
        lock = self.locks.get(key)
        if lock is None:
            lock = self.locks[key] = asyncio.Lock()
        return lock

    @staticmethod
    def _guild_of(room_id: str) -> str:
        # room_id는 항상 f"{guildId}:{hostId}:{uuid}" 형태라 파싱만으로 락을 고를 수 있다.
        return room_id.split(":", 1)[0]

    def embed(self, room):
        playing = room["status"] == "PLAYING"
        description = "경기 진행 중" if playing else "참가 대기 · 5분 후 자동 종료"
        if room.get("last_result"):
            description = room["last_result"] + "\n\n" + description
        embed = discord.Embed(title="도도새배구", description=description, color=discord.Color.green())
        embed.add_field(name="1P · 방장", value=f'<@{room["hostId"]}>')
        embed.add_field(name="2P", value=f'<@{room["p2Id"]}>' if room["p2Id"] else (f'도도봇 · {DIFFICULTIES[room.get("difficulty", "normal")]}' if room.get("mode") == "CPU" else "참가 대기"))
        embed.set_footer(text=f'방 ID: {room["roomId"]}')
        return embed

    async def select_mode(self, ctx: commands.Context):
        if not ctx.guild:
            await ctx.send("서버 채널에서 사용해주세요.")
            return
        view = ModeView(self, ctx)
        self.selection_views.add(view)
        try:
            view.message = await ctx.send(
                embed=discord.Embed(title="도도새배구", description="봇전 또는 대결을 선택해주세요."), view=view)
        except Exception:
            view.stop()
            raise

    async def create_room(self, ctx: commands.Context, *, mode="PVP", difficulty="normal"):
        if mode not in ("CPU", "PVP") or difficulty not in DIFFICULTIES:
            raise ValueError("Invalid game mode or difficulty")
        if not ctx.guild:
            await ctx.send("서버 채널에서 사용해주세요.")
            return
        if not self.server_url or not self.public_url or len(self.secret) < 32:
            await ctx.send("Activity 서버 연결 설정이 필요합니다.")
            return
        async with self._lock_for(ctx.guild.id):
            if any(room["hostId"] == ctx.author.id and room["guildId"] == ctx.guild.id for room in self.rooms.values()):
                await ctx.send("이미 만든 방이 있습니다. 기존 방을 이용해주세요.")
                return
            room_id = f"{ctx.guild.id}:{ctx.author.id}:{uuid.uuid4().hex}"
            room = dict(roomId=room_id, guildId=ctx.guild.id, channelId=ctx.channel.id, messageId=None,
                        hostId=ctx.author.id, p2Id=None, spectators=set(), status="WAITING", handoff=False, mode=mode, difficulty=difficulty, matchId=None, previousMatchId=None)
            self.rooms[room_id] = room
            if mode == "CPU":
                # 대기 화면(게임 시작 버튼 등) 없이 바로 PLAYING 메시지 하나만 보낸다 —
                # WAITING으로 먼저 보냈다가 바로 edit하면 버튼이 잠깐 깜빡여 보인다.
                try:
                    await self._do_handoff(room)
                except (aiohttp.ClientError, asyncio.TimeoutError):
                    self.rooms.pop(room_id, None)
                    await ctx.send("서버 응답을 확인하지 못했습니다. 다시 시도해주세요.")
                    return
            view = LobbyView(self, room_id, room["status"] == "PLAYING")
            try:
                message = await ctx.send(embed=self.embed(room), view=view)
            except Exception:
                self.rooms.pop(room_id, None)
                view.stop()
                raise
            room["messageId"] = message.id
            self.views[room_id] = view
            if room["status"] == "WAITING":
                self.room_tasks[room_id] = asyncio.create_task(self._room_alarm(room_id))
            return room

    async def edit_room(self, room, *, closed: str | None = None):
        old = self.views.pop(room["roomId"], None)
        if old:
            old.stop()
        channel = self.bot.get_channel(room["channelId"])
        if channel is None:
            return
        view = None if closed else LobbyView(self, room["roomId"], room["status"] == "PLAYING")
        if view:
            self.views[room["roomId"]] = view
        try:
            message = channel.get_partial_message(room["messageId"])
            await message.edit(embed=discord.Embed(title="도도새배구", description=closed) if closed else self.embed(room), view=view)
        except discord.HTTPException:
            log.warning("Could not update Dodo lobby message")

    def remove_room(self, room_id):
        room = self.rooms.pop(room_id, None)
        task = self.room_tasks.pop(room_id, None)
        if task and task is not asyncio.current_task():
            task.cancel()
        return room

    async def _room_alarm(self, room_id):
        try:
            await asyncio.sleep(300)
            async with self._lock_for(self._guild_of(room_id)):
                room = self.rooms.get(room_id)
                if room and room["status"] == "WAITING":
                    self.remove_room(room_id)
                    await self.cancel_handoff(room)
                    await self.edit_room(room, closed="시작 대기 시간이 지나 방이 닫혔습니다.")
        finally:
            if self.room_tasks.get(room_id) is asyncio.current_task():
                self.room_tasks.pop(room_id, None)

    async def cancel_handoff(self, room):
        if not self.http:
            return
        try:
            async with self.http.delete(
                self.server_url + "/internal/game-sessions",
                json={"roomId": room["roomId"]},
                headers={"Authorization": "Bearer " + self.secret},
            ) as response:
                await response.read()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            log.warning("Game room cancellation failed; server expiry will clean it up")

    async def action(self, room_id, action, interaction, *, deferred=False):
        if not deferred:
            await interaction.response.defer(ephemeral=True)
        async with self._lock_for(self._guild_of(room_id)):
            room = self.rooms.get(room_id)
            if not room or interaction.guild_id != room["guildId"]:
                await interaction.followup.send("종료된 방입니다.", ephemeral=True)
                return
            user_id = interaction.user.id
            if action == "spectate":
                room["spectators"].add(user_id)
                note = "위 방 메시지의 [배구 하러 가기] 버튼으로 들어오세요." if room["status"] == "PLAYING" else "경기가 시작되면 위 방 메시지의 [배구 하러 가기] 버튼으로 들어오세요."
                await interaction.followup.send(f"관전자로 등록했습니다. {note}", ephemeral=True)
                return
            if action in ("start", "close") and user_id != room["hostId"]:
                await interaction.followup.send("방장만 사용할 수 있습니다.", ephemeral=True)
                return
            if action == "close":
                self.remove_room(room_id)
                await self.cancel_handoff(room)
                await self.edit_room(room, closed="방장이 방을 닫았습니다.")
                await interaction.followup.send("방을 닫았습니다.", ephemeral=True)
                return
            if room["status"] != "WAITING":
                await interaction.followup.send("이미 시작한 경기에는 관전만 가능합니다.", ephemeral=True)
                return
            if action in ("join", "cancel"):
                if room["mode"] == "CPU":
                    await interaction.followup.send("봇전에는 플레이어로 참가할 수 없습니다.", ephemeral=True)
                    return
                if room["handoff"]:
                    await interaction.followup.send("서버에 경기를 전달 중이라 참가자를 변경할 수 없습니다.", ephemeral=True)
                    return
                if action == "join":
                    if room["p2Id"] is not None or user_id == room["hostId"]:
                        await interaction.followup.send("참가 자리가 없거나 이미 방장입니다.", ephemeral=True)
                        return
                    room["p2Id"] = user_id
                    room["spectators"].discard(user_id)
                else:
                    if room["p2Id"] != user_id:
                        await interaction.followup.send("현재 2P만 참가를 취소할 수 있습니다.", ephemeral=True)
                        return
                    room["p2Id"] = None
                await self.edit_room(room)
                await interaction.followup.send("참가했습니다." if action == "join" else "참가를 취소했습니다.", ephemeral=True)
                return
            if room["mode"] == "PVP" and room["p2Id"] is None:
                await interaction.followup.send("대결은 상대가 참가해야 시작할 수 있습니다.", ephemeral=True)
                return
            try:
                await self.handoff_room(room)
            except (aiohttp.ClientError, asyncio.TimeoutError):
                await interaction.followup.send("서버 응답을 확인하지 못했습니다. 같은 시작 버튼으로 재시도하거나 방을 닫아주세요.", ephemeral=True)
                return
            await interaction.followup.send("게임을 시작했습니다. 위 방 메시지의 [배구 하러 가기] 버튼으로 들어오세요.", ephemeral=True)

    async def _do_handoff(self, room):
        if not room["handoff"]:
            room["previousMatchId"] = room["matchId"]
            room["matchId"] = uuid.uuid4().hex
        room["handoff"] = True
        payload = {key: str(room[key]) for key in ("roomId", "guildId", "hostId", "matchId")}
        payload.update(p2Id=str(room["p2Id"]) if room["p2Id"] else None, mode=room["mode"])
        if room["mode"] == "CPU":
            payload["difficulty"] = room["difficulty"]
        async with self.http.post(self.server_url + "/internal/game-sessions", json=payload,
                                  headers={"Authorization": "Bearer " + self.secret}) as response:
            if response.status not in (200, 201):
                raise aiohttp.ClientError("Handoff rejected")
            await response.json()
        room["status"] = "PLAYING"

    async def handoff_room(self, room):
        await self._do_handoff(room)
        task = self.room_tasks.pop(room["roomId"], None)
        if task:
            task.cancel()
        await self.edit_room(room)

    async def game_rematch(self, request):
        supplied = request.headers.get("Authorization", "")
        if len(self.secret) < 32 or not hmac.compare_digest(supplied.encode(), ("Bearer " + self.secret).encode()):
            return web.json_response({"error": "Unauthorized"}, status=401)
        try:
            payload = await request.json()
            if not isinstance(payload, dict) or not all(isinstance(payload.get(key), str) for key in ("roomId", "matchId")):
                raise ValueError
        except (ValueError, TypeError):
            return web.json_response({"error": "Invalid rematch"}, status=400)
        async with self._lock_for(self._guild_of(payload["roomId"])):
            room = self.rooms.get(payload["roomId"])
            if not room:
                return web.json_response({"error": "대기방이 닫혔습니다."}, status=404)
            if payload.get("hostId") != str(room["hostId"]) or payload.get("p2Id") != (str(room["p2Id"]) if room["p2Id"] else None):
                return web.json_response({"error": "참가자가 변경되었습니다. 채팅에서 시작해주세요."}, status=409)
            retry = room["handoff"] and room.get("previousMatchId") == payload["matchId"]
            if retry and room["status"] == "PLAYING":
                return web.json_response({"roomId": room["roomId"], "matchId": room["matchId"]})
            if not retry and (room["status"] != "WAITING" or room["handoff"] or room["matchId"] != payload["matchId"]):
                return web.json_response({"error": "경기 상태가 변경되었습니다."}, status=409)
            try:
                await self.handoff_room(room)
            except (aiohttp.ClientError, asyncio.TimeoutError):
                return web.json_response({"error": "게임 서버 연결에 실패했습니다. 재시도해주세요."}, status=503)
            return web.json_response({"roomId": room["roomId"], "matchId": room["matchId"]})

    async def game_result(self, request):
        supplied = request.headers.get("Authorization", "")
        if len(self.secret) < 32 or not hmac.compare_digest(supplied.encode(), ("Bearer " + self.secret).encode()):
            return web.json_response({"error": "Unauthorized"}, status=401)
        try:
            payload = await request.json()
            room_id = payload["roomId"]
            if not isinstance(room_id, str):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return web.json_response({"error": "Invalid result"}, status=400)
        async with self._lock_for(self._guild_of(room_id)):
            room = self.rooms.get(room_id)
            if not room or payload.get("matchId") != room.get("matchId") or not room["handoff"]:
                # 방이 이미 없거나(닫힘) 방금 처리해서 WAITING으로 되돌린 뒤 온 재시도 배송 —
                # 서버가 계속 재전송하지 않도록 정상 처리된 것처럼 200을 준다.
                return web.json_response({"ok": True})
            if type(payload.get("aborted", False)) is not bool:
                return web.json_response({"error": "Invalid result"}, status=400)
            if not payload.get("aborted"):
                score = payload.get("score", {})
                if not isinstance(score, dict):
                    return web.json_response({"error": "Invalid score"}, status=400)
                left, right = score.get("left"), score.get("right")
                if type(left) is not int or type(right) is not int or not (
                    (left == WIN_SCORE and 0 <= right < WIN_SCORE) or (right == WIN_SCORE and 0 <= left < WIN_SCORE)
                ):
                    return web.json_response({"error": "Invalid score"}, status=400)
                expected = str(room["hostId"]) if left == WIN_SCORE else str(room["p2Id"]) if room["p2Id"] else None
                if payload.get("winnerId") != expected:
                    return web.json_response({"error": "Invalid winner"}, status=400)
                winner = f"<@{expected}>" if expected else "CPU"
                result_line = f"경기 종료 · {winner} 승리 ({left} : {right})"
            else:
                result_line = "연결 종료 또는 시간 초과로 경기가 중단되었습니다."
            # 방을 지우지 않고 WAITING으로 되돌린다 — 같은 방에서 [게임 시작]을 다시 누르면 재대결이 된다.
            room["status"] = "WAITING"
            room["handoff"] = False
            room["last_result"] = result_line
            old_task = self.room_tasks.pop(room_id, None)
            if old_task:
                old_task.cancel()
            self.room_tasks[room_id] = asyncio.create_task(self._room_alarm(room_id))
            await self.edit_room(room)
        return web.json_response({"ok": True})


async def setup(bot):
    await bot.add_cog(DodoVolley(bot))
