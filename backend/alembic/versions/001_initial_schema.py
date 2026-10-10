"""initial schema — all 12 tables

Revision ID: 001
Revises:
Create Date: 2026-10-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "papers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("authors", sa.ARRAY(sa.String), server_default="{}"),
        sa.Column("abstract", sa.Text, nullable=True),
        sa.Column("year", sa.Integer, nullable=True),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("raw_text", sa.Text, nullable=False),
        sa.Column("fingerprint", sa.String(256), unique=True, nullable=False),
        sa.Column("doi", sa.String(256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "paper_sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("index", sa.Integer, nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("raw_text", sa.Text, nullable=False),
    )

    op.create_table(
        "concepts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("difficulty", sa.String(50), nullable=True),
        sa.Column("related_concepts", sa.ARRAY(sa.String), server_default="{}"),
    )

    op.create_table(
        "knowledge_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(256), nullable=False),
        sa.Column("ratings_json", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "agent_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("agent_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "simplified_sections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_index", sa.Integer, nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("simplified_text", sa.Text, nullable=False),
        sa.Column("key_concepts", sa.ARRAY(sa.String), server_default="{}"),
        sa.Column("equations", JSONB, nullable=True),
        sa.Column("media_plan", JSONB, nullable=True),
    )

    op.create_table(
        "generated_images",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("concept", sa.Text, nullable=False),
        sa.Column("image_base64", sa.Text, nullable=False),
        sa.Column("caption", sa.Text, nullable=True),
        sa.Column("seed", sa.Integer, nullable=True),
    )

    op.create_table(
        "generated_canvases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_index", sa.Integer, nullable=False),
        sa.Column("mode", sa.String(50), nullable=True),
        sa.Column("elements_json", JSONB, nullable=True),
    )

    op.create_table(
        "video_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("concept", sa.Text, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("mp4_path", sa.Text, nullable=True),
        sa.Column("manim_script", sa.Text, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "generated_labs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("concept", sa.Text, nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("notebook_json", JSONB, nullable=True),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", sa.String(256), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("response_types", sa.ARRAY(sa.String), server_default="{}"),
        sa.Column("chat_assets", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "chunks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("paper_id", UUID(as_uuid=True), sa.ForeignKey("papers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("section_index", sa.Integer, nullable=True),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", Vector(1024), nullable=True),
        sa.Column("token_count", sa.Integer, nullable=True),
    )

    op.create_index(
        "ix_chunks_embedding_ivfflat",
        "chunks",
        ["embedding"],
        postgresql_using="ivfflat",
        postgresql_with={"lists": 100},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_table("chunks")
    op.drop_table("chat_messages")
    op.drop_table("generated_labs")
    op.drop_table("video_jobs")
    op.drop_table("generated_canvases")
    op.drop_table("generated_images")
    op.drop_table("simplified_sections")
    op.drop_table("agent_jobs")
    op.drop_table("knowledge_profiles")
    op.drop_table("concepts")
    op.drop_table("paper_sections")
    op.drop_table("papers")
    op.execute("DROP EXTENSION IF EXISTS vector")
