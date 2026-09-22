import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp

from bot.cogs.dodovolley import DodoVolley, LobbyView, ModeView


class LobbyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bot = MagicMock()
        self.cog = DodoVolley(self.bot)
        self.cog.secret = "test-secret-" * 4
        self.cog.server_url = "http://activity-server:3001"
        self.cog.public_url = "https://dodobirdactivity.test"
        self.cog.edit_room = AsyncMock()
        self.cog.http = MagicMock()
        self.cog.http.close = AsyncMock()
        response = AsyncMock(status=201)
        self.cog.http.post.return_value.__aenter__ = AsyncMock(return_value=response)
        self.ctx = SimpleNamespace(guild=SimpleNamespace(id=10), author=SimpleNamespace(id=1),
                                   channel=SimpleNamespace(id=20), send=AsyncMock(return_value=SimpleNamespace(id=30)))
        await self.cog.create_room(self.ctx)
        self.room_id = next(iter(self.cog.rooms))
        self.room = self.cog.rooms[self.room_id]

    async def asyncTearDown(self):
        await self.cog.cog_unload()

    def interaction(self, user_id):
        return SimpleNamespace(guild_id=10, user=SimpleNamespace(id=user_id),
                               response=SimpleNamespace(defer=AsyncMock()), followup=SimpleNamespace(send=AsyncMock()))

    async def test_single_room_per_host_and_independent_hosts(self):
        await self.cog.create_room(self.ctx)
        self.assertEqual(len(self.cog.rooms), 1)
        self.ctx.author.id = 2
        await self.cog.create_room(self.ctx)
        self.assertEqual(len(self.cog.rooms), 2)

    async def test_buttons_and_player_permissions(self):
        self.assertEqual(len(LobbyView(self.cog, self.room_id).children), 5)
        playing_children = LobbyView(self.cog, self.room_id, True).children
        self.assertEqual(
            {item.custom_id for item in playing_children if item.custom_id},
            {"dodo:spectate", "dodo:close"},
        )
        link_button = next(item for item in playing_children if item.custom_id is None)
        self.assertEqual(link_button.url, f"https://dodobirdactivity.test/?room={self.room_id}")
        await self.cog.action(self.room_id, "join", self.interaction(1))
        self.assertIsNone(self.room["p2Id"])
        await self.cog.action(self.room_id, "join", self.interaction(2))
        await self.cog.action(self.room_id, "cancel", self.interaction(3))
        self.assertEqual(self.room["p2Id"], 2)
        await self.cog.action(self.room_id, "start", self.interaction(2))
        self.cog.http.post.assert_not_called()
        await self.cog.action(self.room_id, "cancel", self.interaction(2))
        self.assertIsNone(self.room["p2Id"])

    async def test_cpu_start_and_no_late_join(self):
        self.room.update(mode="CPU", difficulty="extreme")
        await self.cog.action(self.room_id, "start", self.interaction(1))
        self.assertEqual(self.room["status"], "PLAYING")
        self.assertEqual(self.cog.http.post.call_args.kwargs["json"]["mode"], "CPU")
        self.assertEqual(self.cog.http.post.call_args.kwargs["json"]["difficulty"], "extreme")
        await self.cog.action(self.room_id, "join", self.interaction(2))
        self.assertIsNone(self.room["p2Id"])
        await self.cog.action(self.room_id, "spectate", self.interaction(3))
        self.assertIn(3, self.room["spectators"])

    async def test_pvp_start_and_result_validation(self):
        await self.cog.action(self.room_id, "join", self.interaction(2))
        await self.cog.action(self.room_id, "start", self.interaction(1))
        self.assertEqual(self.cog.http.post.call_args.kwargs["json"]["p2Id"], "2")
        payload = {"roomId": self.room_id, "matchId": self.room["matchId"], "winnerId": "2", "score": {"left": 1, "right": 5}}
        request = SimpleNamespace(headers={}, json=AsyncMock(return_value=payload))
        self.assertEqual((await self.cog.game_result(request)).status, 401)
        request.headers["Authorization"] = "Bearer " + self.cog.secret
        request.json.return_value = {**payload, "score": []}
        self.assertEqual((await self.cog.game_result(request)).status, 400)
        request.json.return_value = payload
        self.assertEqual((await self.cog.game_result(request)).status, 200)
        # 방은 삭제되지 않고 WAITING으로 돌아가서 재대결이 가능해야 한다.
        self.assertIn(self.room_id, self.cog.rooms)
        self.assertEqual(self.room["status"], "WAITING")
        self.assertFalse(self.room["handoff"])
        self.assertIn("<@2> 승리", self.room["last_result"])
        # 같은 결과가 다시 배송돼도(재시도) 에러 없이 그냥 무시된다.
        self.assertEqual((await self.cog.game_result(request)).status, 200)

    async def test_close_and_unload_cancel_timers(self):
        task = self.cog.room_tasks[self.room_id]
        await self.cog.action(self.room_id, "close", self.interaction(2))
        self.assertIn(self.room_id, self.cog.rooms)
        await self.cog.action(self.room_id, "close", self.interaction(1))
        self.assertNotIn(self.room_id, self.cog.rooms)
        self.assertTrue(task.cancelling())

    async def test_waiting_timeout_removes_room(self):
        task = self.cog.room_tasks[self.room_id]
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        with patch("bot.cogs.dodovolley.asyncio.sleep", new=AsyncMock()):
            await self.cog._room_alarm(self.room_id)
        self.assertNotIn(self.room_id, self.cog.rooms)
        self.assertNotIn(self.room_id, self.cog.room_tasks)

    async def test_inbound_http_server_and_unload(self):
        with patch.dict("os.environ", {"BOT_INTERNAL_HOST": "127.0.0.1", "BOT_INTERNAL_PORT": "0"}):
            await self.cog.cog_load()
        port = self.cog.runner.addresses[0][1]
        self.room["handoff"] = True
        payload = {"roomId": self.room_id, "winnerId": None, "score": {"left": 0, "right": 5}}
        async with aiohttp.ClientSession() as client:
            async with client.post(f"http://127.0.0.1:{port}/internal/game-results", json=payload,
                                   headers={"Authorization": "Bearer " + self.cog.secret}) as response:
                self.assertEqual(response.status, 200)
        self.assertEqual(self.cog.rooms[self.room_id]["status"], "WAITING")


    async def test_pvp_requires_opponent(self):
        await self.cog.action(self.room_id, "start", self.interaction(1))
        self.cog.http.post.assert_not_called()
        self.assertEqual(self.room["status"], "WAITING")
        self.assertFalse(self.room["handoff"])

    async def test_mode_menu_does_not_create_room(self):
        await self.cog.select_mode(self.ctx)
        self.assertEqual(len(self.cog.rooms), 1)
        view = self.ctx.send.call_args.kwargs["view"]
        self.assertEqual([item.label for item in view.children], ["봇전", "대결"])
        view.stop()

    async def test_selection_permissions_and_difficulties(self):
        view = ModeView(self.cog, self.ctx)
        outsider = self.interaction(2)
        outsider.response.send_message = AsyncMock()
        self.assertFalse(await view.interaction_check(outsider))
        host = self.interaction(1)
        host.response.edit_message = AsyncMock()
        self.assertTrue(await view.interaction_check(host))
        await view.cpu.callback(host)
        self.assertEqual([item.label for item in view.children], ["쉬움", "보통", "어려움", "극한"])
        view.stop()

    async def test_cpu_selection_starts_once_and_rematch_preserves_difficulty(self):
        self.cog.remove_room(self.room_id)
        view = ModeView(self.cog, self.ctx)
        host = self.interaction(1)
        host.message = SimpleNamespace(edit=AsyncMock())
        await asyncio.gather(view.choose(host, "CPU", "hard"), view.choose(host, "CPU", "hard"))
        self.assertEqual(len(self.cog.rooms), 1)
        self.cog.http.post.assert_called_once()
        room = next(iter(self.cog.rooms.values()))
        self.assertEqual(room["status"], "PLAYING")
        self.assertEqual(room["difficulty"], "hard")
        self.assertEqual({item.custom_id for item in LobbyView(self.cog, room["roomId"]).children},
                         {"dodo:start", "dodo:spectate", "dodo:close"})
        request = SimpleNamespace(headers={"Authorization": "Bearer " + self.cog.secret},
            json=AsyncMock(return_value={"roomId": room["roomId"], "matchId": room["matchId"], "winnerId": "1", "score": {"left": 5, "right": 2}}))
        await self.cog.game_result(request)
        await self.cog.action(room["roomId"], "start", self.interaction(1))
        self.assertEqual(self.cog.http.post.call_args.kwargs["json"]["difficulty"], "hard")

    async def test_pvp_selection_only_creates_waiting_room(self):
        self.cog.remove_room(self.room_id)
        view = ModeView(self.cog, self.ctx)
        host = self.interaction(1)
        host.message = SimpleNamespace(edit=AsyncMock())
        await view.pvp.callback(host)
        self.cog.http.post.assert_not_called()
        self.assertEqual(next(iter(self.cog.rooms.values()))["mode"], "PVP")


    async def test_three_cpu_matches_sync_lobby_and_reject_old_results(self):
        self.room.update(mode="CPU", difficulty="hard")
        await self.cog.action(self.room_id, "start", self.interaction(1))
        headers = {"Authorization": "Bearer " + self.cog.secret}
        old_payload = None
        for index in range(3):
            current = self.room["matchId"]
            if old_payload:
                await self.cog.game_result(SimpleNamespace(headers=headers, json=AsyncMock(return_value=old_payload)))
                self.assertEqual(self.room["status"], "PLAYING")
            result = {"roomId": self.room_id, "matchId": current, "winnerId": "1", "score": {"left": 5, "right": index}}
            await self.cog.game_result(SimpleNamespace(headers=headers, json=AsyncMock(return_value=result)))
            self.assertEqual(self.room["status"], "WAITING")
            self.assertIn(f"5 : {index}", self.room["last_result"])
            payload = {"roomId": self.room_id, "matchId": current, "hostId": "1", "p2Id": None}
            req = SimpleNamespace(headers=headers, json=AsyncMock(return_value=payload))
            response = await self.cog.game_rematch(req)
            self.assertEqual(response.status, 200)
            self.assertNotEqual(self.room["matchId"], current)
            self.assertEqual(self.room["status"], "PLAYING")
            self.assertNotIn(self.room_id, self.cog.room_tasks)
            calls = self.cog.http.post.call_count
            self.assertEqual((await self.cog.game_rematch(req)).status, 200)
            self.assertEqual(self.cog.http.post.call_count, calls)
            old_payload = result
        await self.cog.action(self.room_id, "close", self.interaction(1))
        self.cog.http.delete.assert_called()
        self.assertEqual((await self.cog.game_rematch(req)).status, 404)

    async def test_rematch_rejects_changed_pvp_roster(self):
        self.room.update(matchId="old", p2Id=3)
        req = SimpleNamespace(headers={"Authorization": "Bearer " + self.cog.secret},
            json=AsyncMock(return_value={"roomId": self.room_id, "matchId": "old", "hostId": "1", "p2Id": "2"}))
        self.assertEqual((await self.cog.game_rematch(req)).status, 409)
        self.cog.http.post.assert_not_called()
