"""comment reply and style

Revision ID: 0003_comment_reply_style
Revises: 0002_post_style_config
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_comment_reply_style"
down_revision: str | None = "0002_post_style_config"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("comments", sa.Column("reply_to_comment_id", sa.Integer(), nullable=True))
    op.add_column("comments", sa.Column("style_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")))
    op.create_foreign_key("fk_comments_reply_to_comment_id", "comments", "comments", ["reply_to_comment_id"], ["id"])
    op.alter_column("comments", "style_config", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_comments_reply_to_comment_id", "comments", type_="foreignkey")
    op.drop_column("comments", "style_config")
    op.drop_column("comments", "reply_to_comment_id")
