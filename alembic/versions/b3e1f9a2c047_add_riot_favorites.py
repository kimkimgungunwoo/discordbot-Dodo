"""add_riot_favorites

Revision ID: b3e1f9a2c047
Revises: 75ea94ac0a32
Create Date: 2026-06-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3e1f9a2c047'
down_revision: Union[str, Sequence[str], None] = '75ea94ac0a32'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "riot_favorites",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("discord_user_id", sa.BigInteger(), nullable=False),
        sa.Column("puuid", sa.String(length=78), nullable=False),
        sa.Column("game_name", sa.String(length=64), nullable=False),
        sa.Column("tag_line", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["discord_user_id"], ["user.user_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("discord_user_id", "puuid"),
    )


def downgrade() -> None:
    op.drop_table("riot_favorites")
