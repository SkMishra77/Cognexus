"""ImageAgent — generates educational SVG diagrams for paper concepts.

Retrieves top 2 RAG chunks for the concept, asks Claude to generate an SVG
diagram, and persists the base64-encoded SVG to generated_images.
"""

import base64
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from db.models import AgentJob, GeneratedImage
from prompts.image_generation import PROMPT_SYSTEM, build_svg_request
from services.bedrock import BedrockClient
from services.retrieval import retrieve_relevant_chunks


def _extract_svg(raw: str) -> str:
    """Extract SVG markup from Claude's response, stripping any wrapper."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    match = re.search(r"(<svg[\s\S]*?</svg>)", text, re.IGNORECASE)
    svg = match.group(1) if match else text

    if not svg.lstrip().startswith("<?xml"):
        svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg
    return svg


class ImageAgent:
    """Generates an educational SVG diagram for a single concept."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        concept_name: str,
        db_session: AsyncSession,
        bedrock: BedrockClient,
        seed: int = 42,
        caption: str | None = None,
    ) -> None:
        self.paper_id = paper_id
        self.concept_name = concept_name
        self.db = db_session
        self.bedrock = bedrock
        self.seed = seed
        self.caption = caption

    async def run(self) -> GeneratedImage:
        """Generate an SVG diagram and persist it. Creates and updates an AgentJob."""
        job = AgentJob(
            paper_id=self.paper_id,
            agent_type="image",
            status="running",
            job_metadata={"phase": 2, "label": f"Image: {self.concept_name}"},
        )
        self.db.add(job)
        await self.db.flush()

        try:
            job.job_metadata = {**(job.job_metadata or {}), "progress": "retrieving context"}
            flag_modified(job, "job_metadata")
            await self.db.flush()
            await self.db.commit()

            chunks = await retrieve_relevant_chunks(
                query=self.concept_name,
                paper_id=self.paper_id,
                source="simplified",
                top_k=2,
                db_session=self.db,
                bedrock_client=self.bedrock,
            )
            context = "\n\n".join(c.content for c in chunks)

            job.job_metadata = {**(job.job_metadata or {}), "progress": "generating SVG diagram"}
            flag_modified(job, "job_metadata")
            await self.db.flush()
            await self.db.commit()

            user_prompt = build_svg_request(self.concept_name, context)
            svg_response = await self.bedrock.invoke_claude(
                PROMPT_SYSTEM, user_prompt, max_tokens=8192
            )

            svg_markup = _extract_svg(svg_response)
            svg_b64 = base64.b64encode(svg_markup.encode("utf-8")).decode("utf-8")

            row = GeneratedImage(
                paper_id=self.paper_id,
                concept=self.concept_name,
                image_base64=svg_b64,
                caption=self.caption or f"Educational diagram: {self.concept_name}",
                seed=self.seed,
            )
            self.db.add(row)

            job.status = "done"
            job.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            return row

        except Exception as e:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            raise

    async def run_for_chat(self) -> GeneratedImage:
        """Convenience wrapper for chat-initiated image generation (no job row)."""
        chunks = await retrieve_relevant_chunks(
            query=self.concept_name,
            paper_id=self.paper_id,
            source="simplified",
            top_k=2,
            db_session=self.db,
            bedrock_client=self.bedrock,
        )
        context = "\n\n".join(c.content for c in chunks)

        user_prompt = build_svg_request(self.concept_name, context)
        svg_response = await self.bedrock.invoke_claude(
            PROMPT_SYSTEM, user_prompt, max_tokens=8192
        )

        svg_markup = _extract_svg(svg_response)
        svg_b64 = base64.b64encode(svg_markup.encode("utf-8")).decode("utf-8")

        row = GeneratedImage(
            paper_id=self.paper_id,
            concept=self.concept_name,
            image_base64=svg_b64,
            caption=f"Educational diagram: {self.concept_name}",
            seed=self.seed,
        )
        self.db.add(row)
        await self.db.flush()
        return row
