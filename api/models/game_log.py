from sqlalchemy import BigInteger, Integer, String, DateTime, ForeignKey, Enum as SAEnum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from api.database import Base
from api.models.enums import GameType
import datetime


class GameLog(Base):
    __tablename__ = "game_log"

    game_log_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.user_id"), nullable=False)
    game_type: Mapped[GameType] = mapped_column(SAEnum(GameType), nullable=False)
    result: Mapped[str] = mapped_column(String, nullable=False)
    point: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="game_logs")
