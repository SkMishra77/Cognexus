"""ResearchAgent — uses Tavily web search to discover background knowledge
for concepts the user doesn't know, chunks + embeds results into the RAG pipeline.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentJob, Chunk, WebSearchResult
from services.bedrock import BedrockClient
from services.chunker import chunk_text
from services.tavily import search as tavily_search

logger = logging.getLogger(__name__)


class ResearchAgent:
    """Searches the web for background material on unknown concepts.

    For each concept the user marked as unknown, queries Tavily for
    tutorials and explainers. Also searches for the paper title itself.
    All results are chunked, embedded, and stored as source='web' in
    the chunks table for downstream RAG retrieval.
    """

    def __init__(
        self,
        paper_id: uuid.UUID,
        paper_title: str,
        concepts: list[dict],
        profile_ratings: dict[str, bool],
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> None:
        self.paper_id = paper_id
        self.paper_title = paper_title
        self.concepts = concepts
        self.profile_ratings = profile_ratings
        self.db = db_session
        self.bedrock = bedrock

    async def run(self) -> list[WebSearchResult]:
        """Execute web research and return saved WebSearchResult rows."""
        job = AgentJob(
            paper_id=self.paper_id,
            agent_type="research",
            status="running",
        )
        self.db.add(job)
        await self.db.flush()

        try:
            results = await self._execute()
            job.status = "done"
            job.completed_at = datetime.now(timezone.utc)
            return results
        except Exception as e:
            logger.error("ResearchAgent failed for paper %s: %s", self.paper_id, e)
            job.status = "failed"
            job.error = str(e)[:500]
            job.completed_at = datetime.now(timezone.utc)
            return []

    async def _execute(self) -> list[WebSearchResult]:
        """Build search tasks, run in parallel, chunk + embed results."""
        # Identify concepts the user does NOT know
        unknown_concepts = [
            c for c in self.concepts
            if not self.profile_ratings.get(c["name"], True)
        ]

        if not unknown_concepts:
            logger.info("ResearchAgent: all concepts known — skipping web search")
            return []

        # Build search tasks: one per unknown concept + one for the paper title
        search_tasks: list[tuple[str, str, int]] = []  # (concept_name, query, max_results)
        for concept in unknown_concepts:
            query = f"{concept['name']} explained simply tutorial"
            search_tasks.append((concept["name"], query, 3))

        # Paper-level search
        paper_query = f"{self.paper_title} summary explained"
        search_tasks.append(("_paper_overview", paper_query, 2))

        # Run all Tavily searches in parallel
        search_coroutines = [
            tavily_search(query, max_results=max_r)
            for _, query, max_r in search_tasks
        ]
        search_results = await asyncio.gather(*search_coroutines, return_exceptions=True)

        # Process results: chunk, embed, store
        all_web_results: list[WebSearchResult] = []
        all_chunks_to_embed: list[str] = []
        chunk_metadata: list[dict] = []  # parallel list tracking paper_id, chunk_index

        global_chunk_index = 0

        for (concept_name, _, _), result in zip(search_tasks, search_results):
            if isinstance(result, Exception):
                logger.warning("Tavily search failed for '%s': %s", concept_name, result)
                continue
            if not result:
                continue

            for item in result:
                title = item.get("title", "")
                url = item.get("url", "")
                content = item.get("content", "")

                if not content.strip():
                    continue

                # Save metadata row
                snippet = content[:500]
                wsr = WebSearchResult(
                    paper_id=self.paper_id,
                    concept=concept_name,
                    title=title,
                    url=url,
                    snippet=snippet,
                )
                self.db.add(wsr)
                all_web_results.append(wsr)

                # Chunk the content for embedding
                text_chunks = chunk_text(content)
                for chunk_content in text_chunks:
                    all_chunks_to_embed.append(chunk_content)
                    chunk_metadata.append(
                        {
                            "chunk_index": global_chunk_index,
                            "concept": concept_name,
                        }
                    )
                    global_chunk_index += 1

        # Embed all chunks in one batch
        if all_chunks_to_embed:
            embeddings = await self.bedrock.embed_batch(all_chunks_to_embed)

            for i, (content, embedding) in enumerate(zip(all_chunks_to_embed, embeddings)):
                self.db.add(
                    Chunk(
                        paper_id=self.paper_id,
                        source="web",
                        section_index=None,
                        chunk_index=chunk_metadata[i]["chunk_index"],
                        content=content,
                        embedding=embedding,
                        token_count=len(content) // 4,
                    )
                )

        logger.info(
            "ResearchAgent: stored %d web results, %d chunks for paper %s",
            len(all_web_results),
            len(all_chunks_to_embed),
            self.paper_id,
        )

        return all_web_results
