"""Marble sends only a room-completion signal, never scores or results."""


def verify_result(payload, room):
    if payload.get("completed") is not True:
        return None
    if any(key in payload for key in ("score", "seatScores", "winnerSeat", "winnerId", "reason")):
        return None
    return "경기 종료"
