"""Rummikub lobby operations and server-result validation (no hidden hands)."""


async def lobby_action(cog, room, action, user):
    """Called under the existing guild lock. Returns a user-facing result."""
    if room["handoff"]:
        return "경기를 전달 중이라 참가자를 변경할 수 없습니다."
    seats = room["seats"]
    previous_seats = [dict(seat) for seat in seats]
    previous_p2 = room.get("p2Id")
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
    elif action in ("bot_normal", "bot_hard", "bot_remove"):
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
            difficulty = action.removeprefix("bot_")
            seats.append({"userId": None, "name": "도도봇 · " + ("어려움" if difficulty == "hard" else "중간"), "bot": difficulty})
    else:
        return "지원하지 않는 조작입니다."
    room["p2Id"] = next((int(s["userId"]) for s in seats[1:] if s["userId"]), None)
    if await cog.edit_room(room) is False:
        seats[:] = previous_seats
        room["p2Id"] = previous_p2
        return "대기방 메시지를 갱신하지 못해 참가자 변경을 취소했습니다. 잠시 후 다시 시도해주세요."
    return "참가 목록을 변경했습니다."


def verify_result(payload, room):
    scores, winner = payload.get("seatScores"), payload.get("winnerSeat")
    seats = room["seats"]
    if not isinstance(scores, list) or len(scores) != len(seats) or any(type(s) is not int or abs(s) > 788 for s in scores):
        return None
    if winner is not None and (type(winner) is not int or not 0 <= winner < len(seats)):
        return None
    if payload.get("winnerId") != (seats[winner]["userId"] if winner is not None else None):
        return None
    if winner is not None and (sum(scores) != 0 or any(score > 0 for i, score in enumerate(scores) if i != winner)):
        return None
    if winner is None and (any(score > 0 for score in scores) or 0 not in scores):
        return None
    title = f"{winner + 1}P 승리" if winner is not None else "두 바퀴 연속 진행 없음으로 종료 · 최소 손패 수 참가자는 감점 없음"
    if winner is not None and any(seat.get("bot") for seat in seats):
        title += " · 봇 보정 적용 (중급 50% / 어려움 75%, 사람끼리 100%)"
    return title + "\n" + " · ".join(f"{i + 1}P {score:+d}점" for i, score in enumerate(scores))
