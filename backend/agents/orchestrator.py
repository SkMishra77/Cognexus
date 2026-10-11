"""Two-phase orchestrator — runs all agents for a paper.

Phase 1: asyncio.gather(SimplificationAgent, ResearchAgent, LabAgent x N, OverviewCanvasAgent)
After Phase 1: chunk + embed simplified text into chunks table (source='simplified')
Phase 2: read media_plan from each section, dispatch media agents as recommended.
Each agent gets its own DB session to avoid concurrent flush/commit conflicts.
All failures are isolated per-agent.
"""

import asyncio
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.canvas_agent import CanvasAgent
from agents.image_agent import ImageAgent
from agents.lab_agent import LabAgent
from agents.research_agent import ResearchAgent
from agents.simplification_agent import SimplificationAgent
from agents.video_agent import VideoAgent
from db.base import async_session
from db.models import Chunk, Concept, Paper, SimplifiedSection
from services.bedrock import BedrockClient
from services.chunker import chunk_text

logger = logging.getLogger(__name__)


async def _run_in_own_session(coro_factory, label: str = "unknown"):
    """Run an agent coroutine with its own DB session.

    coro_factory is a callable(db) -> coroutine that receives a fresh session.
    """
    async with async_session() as db:
        try:
            result = await coro_factory(db)
            await db.commit()
            return result
        except Exception as e:
            logger.exception("Agent '%s' failed in _run_in_own_session", label)
            try:
                await db.commit()
            except Exception:
                await db.rollback()
            raise


async def _chunk_embed_simplified(
    paper_id: uuid.UUID,
    db_session: AsyncSession,
    bedrock: BedrockClient,
) -> int:
    """Chunk simplified text, embed, and store in chunks table (source='simplified')."""
    ss_result = await db_session.execute(
        select(SimplifiedSection)
        .where(SimplifiedSection.paper_id == paper_id)
        .order_by(SimplifiedSection.section_index)
    )
    simplified_sections = list(ss_result.scalars().all())

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

    await db_session.commit()
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
        db_session: Async SQLAlchemy session (used for reads only).
        bedrock: BedrockClient instance.
    """
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
    # Each agent gets its own session via _run_in_own_session.
    paper_title = paper.title

    phase1_tasks = [
        _run_in_own_session(lambda db: SimplificationAgent(
            paper_id, concept_dicts, profile_ratings, db, bedrock
        ).run(), label="simplification"),
        _run_in_own_session(lambda db: ResearchAgent(
            paper_id, paper_title, concept_dicts, profile_ratings, db, bedrock
        ).run(), label="research"),
        *[
            _run_in_own_session(lambda db, cd=cd: LabAgent(
                paper_id, cd, profile_ratings, db, bedrock
            ).run(), label=f"lab:{cd['name']}")
            for cd in concept_dicts[:7]
        ],
        _run_in_own_session(lambda db: CanvasAgent(
            paper_id, section_index=None, mode="overview", db=db, bedrock=bedrock
        ).run(), label="canvas:overview"),
    ]

    phase1_results = await asyncio.gather(*phase1_tasks, return_exceptions=True)

    for i, result in enumerate(phase1_results):
        if isinstance(result, Exception):
            logger.error("Phase 1 task %d failed: %s", i, result)

    # After Phase 1: chunk + embed simplified text (own session)
    async with async_session() as embed_db:
        await _chunk_embed_simplified(paper_id, embed_db, bedrock)

    # ── Phase 2: Media agents based on LLM-driven media_plan ──
    async with async_session() as read_db:
        ss_result = await read_db.execute(
            select(SimplifiedSection)
            .where(SimplifiedSection.paper_id == paper_id)
            .order_by(SimplifiedSection.section_index)
        )
        simplified_sections = list(ss_result.scalars().all())

    # Deduplicate concepts across sections (case-insensitive)
    seen: dict[str, dict] = {}  # lowercase_name -> {types, caption, section_index, name}
    for section in simplified_sections:
        media_plan = section.media_plan or {}
        for concept_name, plan_value in media_plan.items():
            if isinstance(plan_value, list):
                media_types = plan_value
                caption = None
            elif isinstance(plan_value, dict):
                media_types = plan_value.get("types", [])
                caption = plan_value.get("caption")
            else:
                continue
            if not isinstance(media_types, list):
                continue

            key = concept_name.lower()
            if key not in seen:
                seen[key] = {
                    "name": concept_name,
                    "types": set(media_types),
                    "caption": caption,
                    "section_index": section.section_index,
                }
            else:
                seen[key]["types"].update(media_types)
                if caption and not seen[key]["caption"]:
                    seen[key]["caption"] = caption

    media_tasks: list = []
    for entry in seen.values():
        cn = entry["name"]
        cap = entry["caption"]
        si = entry["section_index"]
        if "image" in entry["types"]:
            media_tasks.append(
                _run_in_own_session(lambda db, cn=cn, cap=cap: ImageAgent(
                    paper_id, cn, db, bedrock, caption=cap
                ).run(), label=f"image:{cn}")
            )
        if "canvas" in entry["types"]:
            media_tasks.append(
                _run_in_own_session(lambda db, si=si, cn=cn, cap=cap: CanvasAgent(
                    paper_id, section_index=si, concept=cn, db=db, bedrock=bedrock, caption=cap
                ).run(), label=f"canvas:{cn}")
            )
        if "video" in entry["types"]:
            media_tasks.append(
                _run_in_own_session(lambda db, cn=cn, cap=cap: VideoAgent(
                    paper_id, cn, db, bedrock, caption=cap
                ).run(), label=f"video:{cn}")
            )

    if media_tasks:
        phase2_results = await asyncio.gather(*media_tasks, return_exceptions=True)
        for i, result in enumerate(phase2_results):
            if isinstance(result, Exception):
                logger.error("Phase 2 task %d failed: %s", i, result)
