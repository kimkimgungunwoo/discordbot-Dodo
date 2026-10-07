def verify_result(payload: dict, room: dict) -> str | None:
    score, side = payload.get("score"), payload.get("winnerSide")
    if not isinstance(score, dict) or side not in ("left", "right", "draw"):
        return None
    left, right = score.get("left"), score.get("right")
    moves = payload.get("moveCount")
    if any(type(n) is not int or not 0 <= n <= 64 for n in (left, right)):
        return None
    if type(moves) is not int or not 0 <= moves <= 60 or left + right != moves + 4:
        return None
    expected_side = "left" if left > right else "right" if right > left else "draw"
    expected_id = str(room["hostId"]) if side == "left" else str(room["p2Id"]) if side == "right" and room.get("p2Id") else None
    if side != expected_side or payload.get("winnerId") != expected_id:
        return None
    title = "무승부" if side == "draw" else f"<@{expected_id}> 승리" if expected_id else "도도봇 승리"
    return f"{title} · 1P {left} : {right} 2P · {moves}수"
