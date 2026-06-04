from sqlalchemy import BigInteger, Integer, DateTime, ForeignKey, Enum as SAEnum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from api.database import Base
from api.models.enums import GambleType
import datetime


class GambleLog(Base):
    __tablename__ = "gamble_log"

    gamble_log_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("user.user_id"), nullable=False)
    gamble_type: Mapped[GambleType] = mapped_column(SAEnum(GambleType), nullable=False)
    point: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="gamble_logs")
