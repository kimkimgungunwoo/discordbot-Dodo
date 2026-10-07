from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from . import othello, arrow_dodge, omok, volleyball, rock_run, rummikub


@dataclass(frozen=True)
class GameDefinition:
    key: str
    label: str
    path: str
    modes: tuple[str, ...]
    difficulty_labels: dict[str, str]
    verify_result: Callable[[dict, dict], str | None]
    tracks_best_score: bool = False


GAMES = {
    "othello": GameDefinition("othello", "오델로", "/othello", ("CPU", "PVP"), omok.DIFFICULTY_LABELS, othello.verify_result),
    "rummikub": GameDefinition("rummikub", "루미큐브", "/rummikub", ("PVP",), {"normal": "중간", "hard": "어려움"}, rummikub.verify_result),
    "rock_run": GameDefinition("rock_run", "바위달리기", "/rock-run", ("SOLO",), {}, rock_run.verify_result, True),
    "volleyball": GameDefinition("volleyball", "배구", "/volleyball", ("CPU", "PVP"), volleyball.DIFFICULTY_LABELS, volleyball.verify_result),
    "omok": GameDefinition("omok", "오목", "/omok", ("CPU", "PVP"), omok.DIFFICULTY_LABELS, omok.verify_result),
    "arrow_dodge": GameDefinition("arrow_dodge", "화살피하기", "/arrow-dodge", ("SOLO",), arrow_dodge.DIFFICULTY_LABELS, arrow_dodge.verify_result, True),
}
