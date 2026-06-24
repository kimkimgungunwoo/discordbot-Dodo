"""add_holcham_gambletype

Revision ID: 75ea94ac0a32
Revises: 5c961902b62b
Create Date: 2026-06-05 02:25:07.170164

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '75ea94ac0a32'
down_revision: Union[str, Sequence[str], None] = '5c961902b62b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE gambletype ADD VALUE 'holcham'")


def downgrade() -> None:
    pass
