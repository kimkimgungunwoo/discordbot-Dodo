"""Bomb battle lobby configuration and authoritative result validation."""
DIFFICULTY_LABELS = {"easy": "쉬움", "normal": "보통", "hard": "어려움", "extreme": "극한"}


async def lobby_action(cog, room, action, user):
    if room["handoff"]:
        return "경기를 전달 중이라 참가자를 변경할 수 없습니다."
    seats = room["seats"]
    before, previous_p2 = [dict(s) for s in seats], room.get("p2Id")
    if action == "join":
        if any(s["userId"] == str(user.id) for s in seats):
            return "이미 참가 중입니다."
        if len(seats) >= 4:
            return "자리가 가득 찼습니다."
        seats.append({"userId": str(user.id), "name": user.display_name[:80]})
        room["spectators"].discard(user.id)
    elif action == "cancel":
        if user.id == room["hostId"]:
            return "방장은 방 닫기를 사용해주세요."
        seats[:] = [s for s in seats if s["userId"] != str(user.id)]
    elif action == "bot_remove" or (action.startswith("bot_") and action.removeprefix("bot_") in DIFFICULTY_LABELS):
        if user.id != room["hostId"]:
            return "방장만 봇을 변경할 수 있습니다."
        if action == "bot_remove":
            index = next((i for i in range(len(seats) - 1, -1, -1) if seats[i].get("bot")), None)
            if index is None:
                return "추가된 봇이 없습니다."
            seats.pop(index)
        else:
            if len(seats) >= 4:
                return "자리가 가득 찼습니다."
            level = action.removeprefix("bot_")
            seats.append({"userId": None, "name": "도도봇 · " + DIFFICULTY_LABELS[level], "bot": level})
    else:
        return "지원하지 않는 조작입니다."
    room["p2Id"] = next((int(s["userId"]) for s in seats[1:] if s["userId"]), None)
    if await cog.edit_room(room) is False:
        seats[:] = before
        room["p2Id"] = previous_p2
        return "대기방 메시지를 갱신하지 못해 참가자 변경을 취소했습니다. 잠시 후 다시 시도해주세요."
    return "참가 목록을 변경했습니다."


def settled_scores(winner, seats):
    scores = [0] * len(seats)
    if winner is None:
        return scores
    values = {"easy": 5, "normal": 10, "hard": 15, "extreme": 20}
    for i, seat in enumerate(seats):
        if i != winner:
            points = min(values.get(seat.get("bot"), 20), values.get(seats[winner].get("bot"), 20))
            scores[i] = -points
            scores[winner] += points
    return scores


def verify_result(payload, room):
    seats = room["seats"]
    if "winnerSeat" not in payload:
        return None
    winner, scores = payload["winnerSeat"], payload.get("seatScores")
    if winner is not None and (type(winner) is not int or not 0 <= winner < len(seats)):
        return None
    if not isinstance(scores, list) or len(scores) != len(seats) or any(type(s) is not int for s in scores):
        return None
    if scores != settled_scores(winner, seats):
        return None
    if payload.get("winnerId") != (seats[winner]["userId"] if winner is not None else None):
        return None
    if (winner is None) != (payload.get("winnerSide") == "draw"):
        return None
    if payload.get("score") != {"left": scores[0], "right": scores[1]}:
        return None
    elapsed = payload.get("elapsedMs")
    if type(elapsed) is not int or not 0 <= elapsed <= 120_000:
        return None
    title = "폭탄전 무승부" if winner is None else f"폭탄전 {winner + 1}P · {seats[winner]['name']} 승리!"
    return title + "\n" + " · ".join(f"{i+1}P {score:+}점" for i, score in enumerate(scores))
