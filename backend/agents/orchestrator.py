"""Two-phase orchestrator — runs all agents for a paper.

Phase 1: asyncio.gather(SimplificationAgent, ResearchAgent, LabAgent x N, OverviewCanvasAgent)
After Phase 1: chunk + embed simplified text into chunks table (source='simplified')
Phase 2: read media_plan from each section, dispatch media agents as recommended.
All failures are isolated per-agent.
"""

import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.canvas_agent import CanvasAgent
from agents.image_agent import ImageAgent
from agents.lab_agent import LabAgent
from agents.research_agent import ResearchAgent
from agents.simplification_agent import SimplificationAgent
from agents.video_agent import VideoAgent
from db.models import Chunk, Concept, Paper, SimplifiedSection
from services.bedrock import BedrockClient
from services.chunker import chunk_text


async def _chunk_embed_simplified(
    paper_id: uuid.UUID,
    simplified_sections: list[SimplifiedSection],
    db_session: AsyncSession,
    bedrock: BedrockClient,
) -> int:
    """Chunk simplified text, embed, and store in chunks table (source='simplified')."""
    all_chunks: list[str] = []
    chunk_section_indices: list[int] = []

    for section in simplified_sections:
        section_chunks = chunk_text(section.simplified_text)
        for chunk_content in section_chunks:
            all_chunks.append(chunk_content)
            chunk_section_indices.append(section.section_index)

    if not all_chunks:
        return 0

    embeddings = await bedrock.embed_batch(all_chunks)

    for i, (content, embedding) in enumerate(zip(all_chunks, embeddings)):
        db_session.add(
            Chunk(
                paper_id=paper_id,
                source="simplified",
                section_index=chunk_section_indices[i],
                chunk_index=i,
                content=content,
                embedding=embedding,
                token_count=len(content) // 4,
            )
        )

    return len(all_chunks)


async def run_all_agents(
    paper_id: uuid.UUID,
    profile_ratings: dict[str, bool],
    db_session: AsyncSession,
    bedrock: BedrockClient,
) -> None:
    """Run the two-phase orchestrator for a paper.

    Args:
        paper_id: UUID of the ingested paper.
        profile_ratings: {concept_name: True/False} from the knowledge check.
        db_session: Async SQLAlchemy session.
        bedrock: BedrockClient instance.
    """
    # Fetch paper and concepts
    paper_result = await db_session.execute(
        select(Paper).where(Paper.id == paper_id)
    )
    paper = paper_result.scalar_one_or_none()
    if paper is None:
        raise ValueError(f"Paper {paper_id} not found")

    concept_result = await db_session.execute(
        select(Concept).where(Concept.paper_id == paper_id)
    )
    concepts = concept_result.scalars().all()

    concept_dicts = [
        {
            "name": c.name,
            "description": c.description,
            "difficulty": c.difficulty,
            "related_concepts": c.related_concepts or [],
        }
        for c in concepts
    ]

    # ── Phase 1: Simplification + Labs + Overview Canvas + Research (parallel) ──
    simplification_agent = SimplificationAgent(
        paper, concept_dicts, profile_ratings, db_session, bedrock
    )

    research_agent = ResearchAgent(
        paper_id, paper.title, concept_dicts, profile_ratings, db_session, bedrock
    )

    phase1_tasks = [
        simplification_agent.run(),
        research_agent.run(),
        *[
            LabAgent(paper_id, cd, profile_ratings, db_session, bedrock).run()
            for cd in concept_dicts[:7]
        ],
        CanvasAgent(
            paper_id, section_index=None, mode="overview", db=db_session, bedrock=bedrock
        ).run(),
    ]

    phase1_results = await asyncio.gather(*phase1_tasks, return_exceptions=True)

    # The first result is from the SimplificationAgent
    simplified_sections: list[SimplifiedSection] = []
    if isinstance(phase1_results[0], list):
        simplified_sections = phase1_results[0]

    # After Phase 1: chunk + embed simplified text
    if simplified_sections:
        await _chunk_embed_simplified(paper_id, simplified_sections, db_session, bedrock)

    await db_session.commit()

    # ── Phase 2: Media agents based on LLM-driven media_plan ──
    # Re-fetch simplified sections if needed (in case Phase 1 result was an exception)
    if not simplified_sections:
        ss_result = await db_session.execute(
            select(SimplifiedSection).where(SimplifiedSection.paper_id == paper_id)
        )
        simplified_sections = list(ss_result.scalars().all())

    media_tasks: list = []
    for section in simplified_sections:
        media_plan = section.media_plan or {}
        for concept_name, media_types in media_plan.items():
            if not isinstance(media_types, list):
                continue
            if "image" in media_types:
                media_tasks.append(
                    ImageAgent(paper_id, concept_name, db_session, bedrock).run()
                )
            if "canvas" in media_types:
                media_tasks.append(
                    CanvasAgent(
                        paper_id,
                        section_index=section.section_index,
                        concept=concept_name,
                        db=db_session,
                        bedrock=bedrock,
                    ).run()
                )
            if "video" in media_types:
                media_tasks.append(
                    VideoAgent(paper_id, concept_name, db_session, bedrock).run()
                )

    if media_tasks:
        await asyncio.gather(*media_tasks, return_exceptions=True)

    await db_session.commit()
