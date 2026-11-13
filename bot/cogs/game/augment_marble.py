"""Marble authoritative result validation. Lobby seats use the shared turn-game flow."""


def verify_result(payload, room):
    seats = room["seats"]
    winner = payload.get("winnerSeat")
    if type(winner) is not int or not 0 <= winner < len(seats):
        return None
    if payload.get("winnerId") != seats[winner]["userId"]:
        return None
    scores = payload.get("seatScores")
    expected = [(len(seats) - 1) * 10 if i == winner else -10 for i in range(len(seats))]
    if not isinstance(scores, list) or any(type(s) is not int for s in scores) or scores != expected:
        return None
    reasons = {"triple": "컬러독점 2개", "line": "라인 독점", "bankruptcy": "파산승리", "assets": "60라운드 자산승리"}
    reason = reasons.get(payload.get("reason"))
    if not reason:
        return None
    return f"증강마블 {winner + 1}P 승리 · {reason}\n" + " · ".join(f"{i + 1}P {score:+d}점" for i, score in enumerate(scores))
