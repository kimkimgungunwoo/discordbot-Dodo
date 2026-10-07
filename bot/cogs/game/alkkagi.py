DIFFICULTY_LABELS = {"easy": "쉬움", "normal": "중간", "hard": "어려움", "extreme": "극한"}


def verify_result(payload: dict, room: dict) -> str | None:
    score, side = payload.get("score"), payload.get("winnerSide")
    if not isinstance(score, dict) or side not in ("left", "right", "draw"):
        return None
    left, right = score.get("left"), score.get("right")
    if any(type(n) is not int or not 0 <= n <= 6 for n in (left, right)):
        return None
    if side == "left" and (left == 0 or right != 0) or side == "right" and (right == 0 or left != 0):
        return None
    expected = str(room["hostId"]) if side == "left" else str(room["p2Id"]) if side == "right" and room.get("p2Id") else None
    if payload.get("winnerId") != expected:
        return None
    title = "무승부" if side == "draw" else f"<@{expected}> 승리" if expected else "도도봇 승리"
    return f"{title} · 남은 돌 1P {left} : {right} 2P"
