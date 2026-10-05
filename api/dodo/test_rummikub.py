import datetime
import unittest
from unittest.mock import AsyncMock

from api.dodo.store import DodoGameStore
from bot.cogs.game.stats_view import GameStatsView, FILTERS


class Context:
    def __init__(self, value=None): self.value = value
    async def __aenter__(self): return self.value
    async def __aexit__(self, *args): return False


class Connection:
    def __init__(self):
        self.calls = []
        self.matches = set()
    def transaction(self): return Context()
    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        if "SELECT ruleset_id" in sql: return 42
        if "INSERT INTO dodo_match(" in sql:
            if args[0] in self.matches: return None
            self.matches.add(args[0]); return args[0]
        if "INSERT INTO dodo_player(" in sql: return args[0]
        return 1
    async def execute(self, sql, *args): self.calls.append((sql, args))
    async def fetch(self, sql, *args):
        self.calls.append((sql, args)); return []


class StorageTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = DodoGameStore("configured-for-test")
        self.connection = Connection()
        self.store.pool = type("Pool", (), {"acquire": lambda _: Context(self.connection)})()
        self.room = {"game": "rummikub", "mode": "PVP", "hostId": "1", "p2Id": "2", "guildId": "10",
                     "seats": [{"userId": "1"}, {"userId": None, "bot": "normal"}, {"userId": "2"}, {"userId": None, "bot": "hard"}]}
        self.payload = {"matchId": "points-test", "winnerId": "1", "winnerSeat": 0, "seatScores": [90, -20, -40, -30]}

    async def test_mixed_seats_points_both_scopes_and_idempotency(self):
        self.assertTrue(await self.store.record_match(self.room, self.payload))
        participants = [args for sql, args in self.connection.calls if "INSERT INTO dodo_match_participant" in sql]
        self.assertEqual(len(participants), 4)
        self.assertIn(("points-test", 2, "P3", "SCORE", -40), participants)
        self.assertIn(("points-test", "P2", "SCORE", -20, "normal"), participants)
        stats = [args for sql, args in self.connection.calls if "INSERT INTO dodo_player_stat(" in sql]
        self.assertEqual(len(stats), 4)
        self.assertEqual({(a[0], a[4], a[10]) for a in stats}, {(1, "GLOBAL", 90), (1, "GUILD", 90), (2, "GLOBAL", -40), (2, "GUILD", -40)})
        self.assertTrue(all(a[6:9] == (0, 0, 0) and a[11] == 0 for a in stats))
        count = len(self.connection.calls)
        self.assertFalse(await self.store.record_match(self.room, self.payload))
        self.assertEqual(len(self.connection.calls) - count, 2)

    async def test_four_humans_and_aborted_games(self):
        self.room["seats"] = [{"userId": str(i)} for i in range(1, 5)]
        self.payload.update(aborted=True)
        self.payload.pop("seatScores")
        await self.store.record_match(self.room, self.payload)
        participants = [args for sql, args in self.connection.calls if "INSERT INTO dodo_match_participant" in sql]
        self.assertEqual(len(participants), 4)
        self.assertTrue(all(a[3] == "ABORTED" and a[4] is None for a in participants))
        self.assertFalse(any("INSERT INTO dodo_player_stat" in sql for sql, _ in self.connection.calls))

    async def test_ranking_history_and_point_only_presentation(self):
        await self.store.leaderboard("rummikub", "PVP", "GLOBAL", 0)
        self.assertIn("ORDER BY total_score DESC", self.connection.calls[-1][0])
        await self.store.rummikub_history(1)
        self.assertIn("LIMIT 10", self.connection.calls[-1][0])
        self.assertIn("rummikub:PVP", FILTERS)
        text = GameStatsView._record({"plays": 3, "total_score": -25}, "rummikub", "PVP")
        self.assertIn("-25", text)
        self.assertNotIn("승률", text)

    async def test_history_embed_is_bounded(self):
        self.store.player_stats = AsyncMock(return_value={"plays": 10, "total_score": 150})
        self.store.rummikub_history = AsyncMock(return_value=[{"ended_at": datetime.datetime.now(datetime.UTC), "score": -30, "humans": 2, "bots": 2}] * 10)
        view = GameStatsView(self.store, 1, 10); view.filter_key = "rummikub:PVP"
        interaction = AsyncMock()
        await view._show_mine(interaction)
        embed = interaction.edit_original_response.call_args.kwargs["embed"]
        self.assertLessEqual(len(embed.fields[0].value), 1024)


if __name__ == "__main__": unittest.main()
