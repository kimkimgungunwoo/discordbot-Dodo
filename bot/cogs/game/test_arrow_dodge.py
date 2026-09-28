import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.cogs.game import LobbyView
from bot.cogs.game import test_hub
from bot.cogs.minigame import Minigame


class ArrowDodgeLobbyTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_hub.LobbyTests.asyncSetUp
    asyncTearDown = test_hub.LobbyTests.asyncTearDown
    interaction = test_hub.LobbyTests.interaction

    async def test_command_creates_waiting_solo_lobby_without_handoff(self):
        self.bot.get_cog.return_value = self.cog
        cog = Minigame(self.bot)
        await Minigame.game.callback(cog, self.ctx, game_name="화살피하기")
        room = list(self.cog.rooms.values())[-1]
        self.assertEqual(room["game"], "arrow_dodge")
        self.assertEqual(room["mode"], "SOLO")
        self.assertEqual(room["status"], "WAITING")
        self.cog.http.post.assert_not_called()
        self.assertEqual({item.custom_id for item in LobbyView(self.cog, room["roomId"]).children},
                         {"dodo:start", "dodo:spectate", "dodo:close"})

    async def test_host_start_hands_off_and_exposes_arrow_dodge_link(self):
        room = await self.cog.create_room(self.ctx, game="arrow_dodge", mode="SOLO")
        await self.cog.action(room["roomId"], "start", self.interaction(1))
        payload = self.cog.http.post.call_args.kwargs["json"]
        self.assertEqual((payload["game"], payload["mode"], payload["p2Id"]), ("arrow_dodge", "SOLO", None))
        link = next(item for item in LobbyView(self.cog, room["roomId"], True).children if item.custom_id is None)
        self.assertIn("/arrow-dodge?room=", link.url)
        self.assertEqual(link.label, "화살피하기 하러 가기")

    async def test_survival_result_is_verified_and_shown(self):
        room = await self.cog.create_room(self.ctx, game="arrow_dodge", mode="SOLO")
        await self.cog.action(room["roomId"], "start", self.interaction(1))
        request = SimpleNamespace(headers={"Authorization": "Bearer " + self.cog.secret}, json=AsyncMock(return_value={
            "roomId": room["roomId"], "matchId": room["matchId"], "winnerId": "1", "survivalMs": 12340,
            "score": {"left": 12340, "right": 0},
        }))
        self.assertEqual((await self.cog.game_result(request)).status, 200)
        self.assertIn("12.34초", room["last_result"])
        self.assertEqual(room["status"], "WAITING")


if __name__ == "__main__":
    unittest.main()
