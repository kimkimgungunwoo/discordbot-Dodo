import unittest

from bot.cogs.game.rock_run import verify_result


class RockRunResultTests(unittest.TestCase):
    def test_endless_uses_elapsed_time_as_score(self):
        room = {"hostId": 7, "runMode": "endless"}
        payload = {"winnerId": "7", "score": {"left": 123456, "right": 0}, "stage": 4,
                   "elapsedMs": 123456, "cleared": False, "runMode": "endless"}
        self.assertIn("123.46초", verify_result(payload, room))
        self.assertIsNone(verify_result({**payload, "score": {"left": 123455, "right": 0}}, room))
        self.assertIsNone(verify_result({**payload, "runMode": "normal"}, room))

    def test_normal_mode_keeps_score_rules(self):
        room = {"hostId": 7, "runMode": "normal"}
        payload = {"winnerId": "7", "score": {"left": 90000, "right": 0}, "stage": 6,
                   "elapsedMs": 240000, "cleared": True, "runMode": "normal"}
        self.assertIn("90,000점", verify_result(payload, room))


if __name__ == "__main__":
    unittest.main()
