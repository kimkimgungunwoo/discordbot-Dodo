from dataclasses import dataclass


@dataclass
class VoiceHourly:
    hour: int
    total_seconds: int
