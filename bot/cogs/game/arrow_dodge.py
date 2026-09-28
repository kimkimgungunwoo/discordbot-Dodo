from __future__ import annotations

DIFFICULTY_LABELS: dict[str, str] = {}


def verify_result(payload: dict, room: dict) -> str | None:
    survival_ms = payload.get("survivalMs")
    if type(survival_ms) is not int or not 0 <= survival_ms <= 20 * 60 * 1000:
        return None
    if payload.get("winnerId") != str(room["hostId"]):
        return None
    return f"게임 종료 · <@{room['hostId']}> 생존 기록 {survival_ms / 1000:.2f}초"
