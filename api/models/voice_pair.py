from dataclasses import dataclass


@dataclass
class VoicePair:
    a: int  # 항상 a < b
    b: int
    total_seconds: int
