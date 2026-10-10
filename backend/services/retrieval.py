import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Chunk
from services.bedrock import BedrockClient


async def retrieve_relevant_chunks(
    query: str,
    paper_id: uuid.UUID,
    source: str = "all",
    top_k: int = 5,
    db_session: AsyncSession = None,
    bedrock_client: BedrockClient = None,
) -> list[Chunk]:
    """Retrieve the most relevant chunks for a query using pgvector cosine similarity.

    Args:
        query: The text query to search for.
        paper_id: Restrict search to this paper.
        source: Chunk source filter — 'raw', 'simplified', 'web', or 'all'.
                When 'all', searches across all sources (raw + simplified + web).
        top_k: Number of top results to return.
        db_session: Async SQLAlchemy session.
        bedrock_client: Bedrock client for generating query embeddings.

    Returns:
        List of Chunk ORM objects ordered by relevance (most similar first).
    """
    query_embedding = await bedrock_client.embed_text(query)

    stmt = select(Chunk).where(
        Chunk.paper_id == paper_id,
        Chunk.embedding.isnot(None),
    )

    if source != "all":
        stmt = stmt.where(Chunk.source == source)

    stmt = stmt.order_by(Chunk.embedding.cosine_distance(query_embedding)).limit(top_k)

    result = await db_session.execute(stmt)
    return list(result.scalars().all())
