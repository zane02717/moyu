"""comment likes

Revision ID: 0004_comment_likes
Revises: 0003_comment_reply_style
Create Date: 2026-05-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_comment_likes"
down_revision: str | None = "0003_comment_reply_style"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("comments", sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "comment_likes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("comment_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "comment_id", name="uq_comment_likes_user_comment"),
    )
    op.create_index(op.f("ix_comment_likes_id"), "comment_likes", ["id"], unique=False)
    op.alter_column("comments", "like_count", server_default=None)


def downgrade() -> None:
    op.drop_index(op.f("ix_comment_likes_id"), table_name="comment_likes")
    op.drop_table("comment_likes")
    op.drop_column("comments", "like_count")
