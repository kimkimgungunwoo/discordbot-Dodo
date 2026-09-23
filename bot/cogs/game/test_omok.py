import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.cogs.game import LobbyView, ModeView
from bot.cogs.game import test_hub
from bot.cogs.minigame import Minigame


class OmokLobbyTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_hub.LobbyTests.asyncSetUp
    asyncTearDown = test_hub.LobbyTests.asyncTearDown
    interaction = test_hub.LobbyTests.interaction
    async def test_omok_handoff_links_and_result(self):
        room = await self.cog.create_room(self.ctx, game="omok", mode="CPU", difficulty="normal")
        self.assertEqual(room["status"], "PLAYING")
        self.assertEqual(self.cog.http.post.call_args.kwargs["json"]["game"], "omok")
        link = next(item for item in LobbyView(self.cog, room["roomId"], True).children if item.custom_id is None)
        self.assertIn("/omok?room=", link.url)
        self.assertEqual(link.label, "오목 하러 가기")
        request = SimpleNamespace(headers={"Authorization": "Bearer " + self.cog.secret}, json=AsyncMock(return_value={
            "roomId": room["roomId"], "matchId": room["matchId"], "winnerSide": "left", "winnerId": "1",
        }))
        self.assertEqual((await self.cog.game_result(request)).status, 200)
        self.assertEqual(room["status"], "WAITING")
        self.assertIn("승리", room["last_result"])

    async def test_omok_draw_and_invalid_winner(self):
        room = await self.cog.create_room(self.ctx, game="omok", mode="CPU")
        payload = {"roomId": room["roomId"], "matchId": room["matchId"], "winnerSide": "left", "winnerId": "intruder"}
        request = SimpleNamespace(headers={"Authorization": "Bearer " + self.cog.secret}, json=AsyncMock(return_value=payload))
        self.assertEqual((await self.cog.game_result(request)).status, 400)
        payload.update(winnerSide="draw", winnerId=None)
        self.assertEqual((await self.cog.game_result(request)).status, 200)
        self.assertIn("무승부", room["last_result"])

    async def test_omok_difficulty_labels(self):
        view = ModeView(self.cog, self.ctx, "omok")
        interaction = self.interaction(1)
        interaction.response.edit_message = AsyncMock()
        await view.cpu.callback(interaction)
        self.assertEqual([item.label for item in view.children], ["쉬움", "중간", "어려움", "극한", "초월"])
        view.stop()

    async def test_command_routes_omok_and_rejects_unknown_names(self):
        self.bot.get_cog.return_value = self.cog
        self.cog.select_mode = AsyncMock()
        cog = Minigame(self.bot)
        await Minigame.game.callback(cog, self.ctx, game_name="오목")
        self.cog.select_mode.assert_awaited_once_with(self.ctx, game="omok")
        await Minigame.game.callback(cog, self.ctx, game_name="없는게임")
        self.assertEqual(self.cog.select_mode.await_count, 1)


if __name__ == "__main__":
    unittest.main()
