from __future__ import annotations

# games/client의 volleyball/constants.ts, games/server의 volleyball-room.ts WIN_SCORE와 반드시 같은 값이어야 한다.
WIN_SCORE = 7
DIFFICULTY_LABELS = {"easy": "쉬움", "normal": "보통", "hard": "어려움", "extreme": "극한"}


def verify_result(payload: dict, room: dict) -> str | None:
    score = payload.get("score", {})
    if not isinstance(score, dict):
        return None
    left, right = score.get("left"), score.get("right")
    if type(left) is not int or type(right) is not int or not (
        (left == WIN_SCORE and 0 <= right < WIN_SCORE) or (right == WIN_SCORE and 0 <= left < WIN_SCORE)
    ):
        return None
    expected = str(room["hostId"]) if left == WIN_SCORE else str(room["p2Id"]) if room["p2Id"] else None
    if payload.get("winnerId") != expected:
        return None
    winner = f"<@{expected}>" if expected else "CPU"
    return f"경기 종료 · {winner} 승리 ({left} : {right})"
