from sqlalchemy import BigInteger, Integer, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from api.database import Base
import datetime


class User(Base):
    __tablename__ = "user"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    point: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    attendances: Mapped[list["Attendance"]] = relationship(back_populates="user")
    game_logs: Mapped[list["GameLog"]] = relationship(back_populates="user")
    gamble_logs: Mapped[list["GambleLog"]] = relationship(back_populates="user")
    point_histories: Mapped[list["PointHistory"]] = relationship(back_populates="user")
