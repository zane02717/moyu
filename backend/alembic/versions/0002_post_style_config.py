"""add post style config

Revision ID: 0002_post_style_config
Revises: 0001_initial
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_post_style_config"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("posts", sa.Column("style_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.alter_column("posts", "style_config", server_default=None)


def downgrade() -> None:
    op.drop_column("posts", "style_config")
