from __future__ import annotations

from . import volleyball

DIFFICULTY_LABELS = {**volleyball.DIFFICULTY_LABELS, "normal": "중간", "transcendent": "초월"}


def verify_result(payload: dict, room: dict) -> str | None:
    winner_side = payload.get("winnerSide")
    if winner_side not in ("left", "right", "draw"):
        return None
    expected = str(room["hostId"]) if winner_side == "left" else str(room["p2Id"]) if winner_side == "right" and room["p2Id"] else None
    if payload.get("winnerId") != expected:
        return None
    winner = f"<@{expected}>" if expected else "CPU"
    return "경기 종료 · 무승부" if winner_side == "draw" else f"경기 종료 · {winner} 승리"
