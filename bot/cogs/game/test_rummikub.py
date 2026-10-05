import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from discord.ui.view import ViewStore

from bot.cogs.game import Game, LobbyView
from bot.cogs.game.rummikub import verify_result


class RummikubLobbyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cog = Game(MagicMock())
        self.cog.secret = "test-only-" * 4
        self.cog.server_url = "http://activity-server:3001"
        self.cog.public_url = "https://activity.example.test"
        self.cog.edit_room = AsyncMock()
        self.cog.stats.record_match = AsyncMock(return_value=True)
        self.cog.http = MagicMock()
        self.cog.http.close = AsyncMock()
        self.cog.http.post.return_value.__aenter__ = AsyncMock(return_value=AsyncMock(status=201))
        self.ctx = SimpleNamespace(guild=SimpleNamespace(id=10), author=SimpleNamespace(id=1, display_name="Host"), channel=SimpleNamespace(id=20), send=AsyncMock(return_value=SimpleNamespace(id=30)))
        self.room = await self.cog.select_mode(self.ctx, game="rummikub")

    async def asyncTearDown(self):
        await self.cog.cog_unload()

    async def action(self, name, user_id=1):
        event = SimpleNamespace(guild_id=10, user=SimpleNamespace(id=user_id, display_name=f"User {user_id}"), response=SimpleNamespace(defer=AsyncMock()), followup=SimpleNamespace(send=AsyncMock()), message=AsyncMock())
        await self.cog.action(self.room["roomId"], name, event)
        return event

    async def test_lobby_add_humans_bots_capacity_and_host_only_start(self):
        self.assertEqual(len(LobbyView(self.cog, self.room["roomId"]).children), 8)
        await self.action("start")
        self.cog.http.post.assert_not_called()
        await self.action("bot_hard", 2)
        self.assertEqual(len(self.room["seats"]), 1)
        await self.action("join", 2)
        await self.action("bot_normal")
        await self.action("bot_hard")
        await self.action("join", 3)
        self.assertEqual(len(self.room["seats"]), 4)
        await self.action("start", 2)
        self.cog.http.post.assert_not_called()
        await self.action("start")
        payload = self.cog.http.post.call_args.kwargs["json"]
        self.assertEqual(payload["game"], "rummikub")
        self.assertEqual([s["userId"] for s in payload["seats"]], ["1", "2", None, None])
        self.assertEqual(payload["seats"][3]["bot"], "hard")
        self.assertEqual(self.room["status"], "PLAYING")
        await self.action("cancel", 2)
        self.assertEqual(len(self.room["seats"]), 4)
        playing = LobbyView(self.cog, self.room["roomId"], True)
        self.assertEqual(len(playing.children), 3)
        self.assertIn("/rummikub?room=", next(c.url for c in playing.children if c.url))

    async def test_human_cancellation_bot_removal_and_result_return_to_lobby(self):
        await self.action("join", 2)
        await self.action("cancel", 2)
        await self.action("bot_normal")
        await self.action("bot_remove", 2)
        self.assertEqual(len(self.room["seats"]), 2)
        await self.action("bot_remove")
        self.assertEqual(len(self.room["seats"]), 1)
        await self.action("bot_hard")
        await self.action("start")
        payload = {"roomId": self.room["roomId"], "matchId": self.room["matchId"], "winnerId": None, "winnerSeat": 1, "seatScores": [-30, 30]}
        self.assertIsNotNone(verify_result(payload, self.room))
        self.assertIsNone(verify_result({**payload, "seatScores": [30, 30]}, self.room))
        self.assertIsNone(verify_result({**payload, "winnerId": "1"}, self.room))
        request = SimpleNamespace(headers={"Authorization": "Bearer " + self.cog.secret}, json=AsyncMock(return_value=payload))
        self.assertEqual((await self.cog.game_result(request)).status, 200)
        self.cog.stats.record_match.assert_awaited_once_with(self.room, payload)
        self.assertEqual(self.room["status"], "WAITING")
        self.assertIn("2P 승리", self.room["last_result"])
        self.assertEqual(len(self.room["seats"]), 2)

    async def test_lobby_remove_button_routes_to_host_action_and_refreshes_view(self):
        await self.action("bot_hard")
        view = LobbyView(self.cog, self.room["roomId"])
        button = next(item for item in view.children if item.label == "봇 제거")
        self.assertTrue(button.custom_id.startswith("dodo:rummikub:bot_remove:"))
        self.assertLessEqual(len(button.custom_id), 100)
        event = SimpleNamespace(guild_id=10, user=SimpleNamespace(id=1, display_name="Host"),
                                response=SimpleNamespace(defer=AsyncMock()), followup=SimpleNamespace(send=AsyncMock()), message=AsyncMock())
        await button.callback(event)
        self.assertEqual(len(self.room["seats"]), 1)
        self.cog.edit_room.assert_awaited()
        self.assertIn("참가 목록을 변경했습니다", event.followup.send.call_args.args[0])

    async def test_failed_lobby_message_edit_rolls_back_bot_removal(self):
        await self.action("bot_hard")
        before = [dict(seat) for seat in self.room["seats"]]
        self.cog.edit_room.return_value = False
        event = await self.action("bot_remove")
        self.assertEqual(self.room["seats"], before)
        self.assertIn("취소했습니다", event.followup.send.call_args.args[0])

    async def test_refresh_keeps_new_button_handlers_registered(self):
        store = ViewStore(MagicMock())
        message_id = self.room["messageId"]
        old = LobbyView(self.cog, self.room["roomId"])
        store.add_view(old, message_id)
        self.cog.views[self.room["roomId"]] = old
        async def edit(**kwargs):
            store.add_view(kwargs["view"], message_id)
        self.cog.bot.get_channel.return_value.get_partial_message.return_value.edit = AsyncMock(side_effect=edit)
        self.cog.bot.add_view.side_effect = lambda view, *, message_id: store.add_view(view, message_id)
        for _ in range(3):
            self.assertTrue(await Game.edit_room(self.cog, self.room))
            current = self.cog.views[self.room["roomId"]]
            for item in current.children:
                if item.is_dispatchable():
                    self.assertIs(store._views[message_id][(item.type.value, item.custom_id)], item)


    async def test_stalled_result_keeps_zero_penalty_and_explains_two_rounds(self):
        await self.action("join", 2)
        payload = {"winnerId": None, "winnerSeat": None, "seatScores": [0, -30]}
        self.assertIn("두 바퀴", verify_result(payload, self.room))
        self.assertIn("감점 없음", verify_result(payload, self.room))
        self.assertIsNone(verify_result({**payload, "seatScores": [-10, -30]}, self.room))


if __name__ == "__main__":
    unittest.main()
