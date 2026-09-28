from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from . import arrow_dodge, omok, volleyball


@dataclass(frozen=True)
class GameDefinition:
    key: str
    label: str
    path: str
    modes: tuple[str, ...]
    difficulty_labels: dict[str, str]
    verify_result: Callable[[dict, dict], str | None]


GAMES = {
    "volleyball": GameDefinition("volleyball", "배구", "/volleyball", ("CPU", "PVP"), volleyball.DIFFICULTY_LABELS, volleyball.verify_result),
    "omok": GameDefinition("omok", "오목", "/omok", ("CPU", "PVP"), omok.DIFFICULTY_LABELS, omok.verify_result),
    "arrow_dodge": GameDefinition("arrow_dodge", "화살피하기", "/arrow-dodge", ("SOLO",), arrow_dodge.DIFFICULTY_LABELS, arrow_dodge.verify_result),
}
