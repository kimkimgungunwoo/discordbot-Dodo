from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from . import omok, volleyball


@dataclass(frozen=True)
class GameDefinition:
    key: str
    label: str
    difficulty_labels: dict[str, str]
    verify_result: Callable[[dict, dict], str | None]


GAMES = {
    "volleyball": GameDefinition("volleyball", "배구", volleyball.DIFFICULTY_LABELS, volleyball.verify_result),
    "omok": GameDefinition("omok", "오목", omok.DIFFICULTY_LABELS, omok.verify_result),
}
