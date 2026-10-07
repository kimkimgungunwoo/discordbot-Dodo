import unittest
from unittest.mock import AsyncMock, MagicMock
from types import SimpleNamespace
from bot.cogs.game.othello import verify_result
from bot.cogs.game.registry import GAMES
from bot.cogs.minigame import Minigame


class OthelloTests(unittest.IsolatedAsyncioTestCase):
    def test_result_and_cpu_draw(self):
        room = {"hostId": 1, "p2Id": 2}
        payload = {"winnerId": "1", "winnerSide": "left", "score": {"left": 40, "right": 24}, "moveCount": 60}
        self.assertIsNotNone(verify_result(payload, room))
        self.assertIsNone(verify_result({**payload, "winnerSide": "right"}, room))
        self.assertIsNone(verify_result({**payload, "moveCount": 59}, room))
        room["p2Id"] = None
        self.assertIsNotNone(verify_result({**payload, "winnerId": None, "winnerSide": "right", "score": {"left": 24, "right": 40}}, room))
        self.assertIsNotNone(verify_result({**payload, "winnerId": None, "winnerSide": "draw", "score": {"left": 32, "right": 32}}, room))

    async def test_menu_routes_and_five_difficulties(self):
        bot = MagicMock(); cog = bot.get_cog.return_value
        cog.select_mode = AsyncMock()
        ctx = SimpleNamespace(send=AsyncMock())
        await Minigame(bot)._route_dodo_game(ctx, "오델로")
        cog.select_mode.assert_awaited_once_with(ctx, game="othello")
        self.assertEqual(list(GAMES["othello"].difficulty_labels), ["easy", "normal", "hard", "extreme", "transcendent"])
