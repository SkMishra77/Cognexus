"""add caption column to generated_canvases and video_jobs

Revision ID: 004
Revises: 003
Create Date: 2026-10-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("generated_canvases", sa.Column("caption", sa.Text(), nullable=True))
    op.add_column("video_jobs", sa.Column("caption", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("video_jobs", "caption")
    op.drop_column("generated_canvases", "caption")
