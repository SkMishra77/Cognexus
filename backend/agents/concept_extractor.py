"""Concept extraction agent using map-reduce over paper text.

Splits the paper's raw text into ~10k-character segments, calls Claude on
each segment in parallel to extract concepts, then merges and ranks them
in a final Claude call. Persists results to the concepts table.
"""

import asyncio
import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Concept, Paper
from prompts.concept_extraction import (
    RANKING_SYSTEM,
    SYSTEM,
    build_ranking_user,
    build_user,
)
from services.bedrock import BedrockClient

SEGMENT_SIZE = 10_000  # ~10k characters per segment


def _split_into_segments(text: str, size: int = SEGMENT_SIZE) -> list[str]:
    """Split text into roughly equal segments, breaking at paragraph boundaries."""
    if len(text) <= size:
        return [text]

    segments: list[str] = []
    start = 0
    while start < len(text):
        end = start + size
        if end >= len(text):
            segments.append(text[start:])
            break
        # Try to break at a paragraph boundary
        newline_pos = text.rfind("\n\n", start, end)
        if newline_pos > start:
            end = newline_pos
        else:
            newline_pos = text.rfind("\n", start, end)
            if newline_pos > start:
                end = newline_pos
        segments.append(text[start:end].strip())
        start = end
    return [s for s in segments if s]


def _safe_parse_concepts(raw: str) -> list[dict]:
    """Parse Claude's JSON response, tolerating markdown fences."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]  # drop opening fence
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    return []


class ConceptExtractor:
    """Extracts prerequisite concepts from a paper using map-reduce with Claude."""

    async def run(
        self,
        paper_id: uuid.UUID,
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> list[dict]:
        """Extract, merge, rank, and persist concepts for a paper.

        Args:
            paper_id: UUID of the paper in the DB.
            db_session: Async SQLAlchemy session.
            bedrock: BedrockClient for Claude calls.

        Returns:
            List of concept dicts [{name, description, difficulty, related_concepts}].
        """
        # Fetch paper raw text
        result = await db_session.execute(
            select(Paper).where(Paper.id == paper_id)
        )
        paper = result.scalar_one_or_none()
        if paper is None:
            raise ValueError(f"Paper {paper_id} not found")

        raw_text = paper.raw_text
        segments = _split_into_segments(raw_text)
        total = len(segments)

        # Map phase: extract concepts from each segment in parallel
        async def _extract_segment(idx: int, segment_text: str) -> list[dict]:
            user_prompt = build_user(segment_text, idx, total)
            response = await bedrock.invoke_claude(SYSTEM, user_prompt, max_tokens=4096)
            return _safe_parse_concepts(response)

        segment_results = await asyncio.gather(
            *(_extract_segment(i, seg) for i, seg in enumerate(segments)),
            return_exceptions=True,
        )

        # Flatten all concepts (skip exceptions)
        all_concepts: list[dict] = []
        for result in segment_results:
            if isinstance(result, list):
                all_concepts.extend(result)

        if not all_concepts:
            return []

        # Reduce phase: merge + rank via a final Claude call
        all_concepts_json = json.dumps(all_concepts, ensure_ascii=False)
        ranking_user = build_ranking_user(all_concepts_json)
        ranking_response = await bedrock.invoke_claude(
            RANKING_SYSTEM, ranking_user, max_tokens=4096
        )
        ranked = _safe_parse_concepts(ranking_response)

        if not ranked:
            # Fallback: deduplicate by name and take first 15
            seen: set[str] = set()
            for c in all_concepts:
                name_lower = c.get("name", "").lower().strip()
                if name_lower and name_lower not in seen:
                    seen.add(name_lower)
                    ranked.append(c)
                if len(ranked) >= 15:
                    break

        # Persist to DB
        for concept_data in ranked:
            concept = Concept(
                paper_id=paper_id,
                name=concept_data.get("name", "Unknown"),
                description=concept_data.get("description", ""),
                difficulty=concept_data.get("difficulty"),
                related_concepts=concept_data.get("related_concepts", []),
            )
            db_session.add(concept)
        await db_session.commit()

        return ranked
