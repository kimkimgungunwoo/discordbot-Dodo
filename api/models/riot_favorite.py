from sqlalchemy import BigInteger, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from api.database import Base
import datetime


class RiotFavorite(Base):
    __tablename__ = "riot_favorites"
    __table_args__ = (UniqueConstraint("discord_user_id", "puuid"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    discord_user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("user.user_id", ondelete="CASCADE")
    )
    puuid: Mapped[str] = mapped_column(String(78))
    game_name: Mapped[str] = mapped_column(String(64))
    tag_line: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=False), server_default=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="riot_favorites")
