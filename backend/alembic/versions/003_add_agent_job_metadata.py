"""add metadata column to agent_jobs

Revision ID: 003
Revises: 002
Create Date: 2026-10-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("agent_jobs", sa.Column("metadata", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("agent_jobs", "metadata")
