"""add_lotdraw_gametype

Revision ID: 5c961902b62b
Revises: 21379b6cc8c2
Create Date: 2026-06-05 01:53:32.040993

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5c961902b62b'
down_revision: Union[str, Sequence[str], None] = '21379b6cc8c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE gametype ADD VALUE 'lotdraw'")


def downgrade() -> None:
    # PostgreSQL은 enum 값 삭제를 지원하지 않음 — 필요 시 타입 재생성 필요
    pass
