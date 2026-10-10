"""add web_search_results table

Revision ID: 002
Revises: 001
Create Date: 2026-10-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "web_search_results",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("concept", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("snippet", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_index(
        "ix_web_search_results_paper_id",
        "web_search_results",
        ["paper_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_web_search_results_paper_id", table_name="web_search_results")
    op.drop_table("web_search_results")
