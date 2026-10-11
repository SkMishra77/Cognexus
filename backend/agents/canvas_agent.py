"""CanvasAgent — generates Excalidraw diagram JSON for paper sections/concepts.

Retrieves top 3 RAG chunks, asks Claude to generate Excalidraw elements JSON,
validates the JSON structure, retries once on parse failure, and persists
the result to generated_canvases.
"""

import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from db.models import AgentJob, GeneratedCanvas
from prompts.canvas_generation import SYSTEM, build_user
from services.bedrock import BedrockClient
from services.retrieval import retrieve_relevant_chunks

VALID_TYPES = {"rectangle", "ellipse", "arrow", "text", "diamond"}


def _parse_elements_json(raw: str) -> list[dict]:
    """Parse the Excalidraw elements JSON from Claude's response.

    Handles raw JSON arrays, markdown-fenced JSON, or extracts the first [...] block.
    """
    text = raw.strip()

    # Strip markdown fences
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]  # drop opening fence line
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # Try direct parse
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass

    # Find first [...] block
    match = re.search(r"\[[\s\S]*\]", text)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass

    raise ValueError("Could not parse Excalidraw elements JSON from response")


def _validate_elements(elements: list[dict]) -> bool:
    """Basic structural validation of Excalidraw elements."""
    if not isinstance(elements, list) or len(elements) == 0:
        return False
    for el in elements:
        if not isinstance(el, dict):
            return False
        if "type" not in el or "id" not in el:
            return False
    return True


class CanvasAgent:
    """Generates an Excalidraw diagram for a section or concept."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        section_index: int | None = None,
        concept: str | None = None,
        mode: str = "section",
        db: AsyncSession | None = None,
        bedrock: BedrockClient | None = None,
        caption: str | None = None,
    ) -> None:
        self.paper_id = paper_id
        self.section_index = section_index
        self.concept = concept
        self.mode = mode
        self.db = db
        self.bedrock = bedrock
        self.caption = caption

    async def _generate_elements(self, context: str) -> list[dict]:
        """Call Claude to generate elements, retrying once on parse failure."""
        user_prompt = build_user(context, mode=self.mode, concept=self.concept)

        for attempt in range(2):
            response = await self.bedrock.invoke_claude(SYSTEM, user_prompt, max_tokens=8192)
            try:
                elements = _parse_elements_json(response)
                if _validate_elements(elements):
                    return elements
            except ValueError:
                if attempt == 0:
                    continue
                raise

        raise ValueError("Failed to generate valid Excalidraw JSON after 2 attempts")

    async def run(self) -> GeneratedCanvas:
        """Generate a canvas and persist it. Creates and updates an AgentJob."""
        with self.db.no_autoflush:
            phase = 1 if self.mode == "overview" else 2
            label = "Diagram: Overview" if self.mode == "overview" else f"Diagram: {self.concept or 'Section'}"
            job = AgentJob(
                paper_id=self.paper_id,
                agent_type="canvas",
                status="running",
                job_metadata={"phase": phase, "concept": self.concept, "label": label},
            )
            self.db.add(job)
            await self.db.flush()

            try:
                job.job_metadata = {**(job.job_metadata or {}), "progress": "retrieving context"}
                flag_modified(job, "job_metadata")
                await self.db.flush()
                await self.db.commit()

                source = "raw" if self.mode == "overview" else "simplified"
                query = self.concept or "paper overview architecture"
                chunks = await retrieve_relevant_chunks(
                    query=query,
                    paper_id=self.paper_id,
                    source=source,
                    top_k=3,
                    db_session=self.db,
                    bedrock_client=self.bedrock,
                )
                context = "\n\n".join(c.content for c in chunks)

                job.job_metadata = {**(job.job_metadata or {}), "progress": "generating diagram"}
                flag_modified(job, "job_metadata")
                await self.db.flush()
                await self.db.commit()

                elements = await self._generate_elements(context)

                row = GeneratedCanvas(
                    paper_id=self.paper_id,
                    section_index=self.section_index if self.section_index is not None else 0,
                    mode=self.mode,
                    elements_json=elements,
                    caption=self.caption,
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

    async def run_for_chat(self) -> GeneratedCanvas:
        """Convenience wrapper for chat-initiated canvas generation (no job row)."""
        source = "simplified"
        query = self.concept or "paper overview"
        chunks = await retrieve_relevant_chunks(
            query=query,
            paper_id=self.paper_id,
            source=source,
            top_k=3,
            db_session=self.db,
            bedrock_client=self.bedrock,
        )
        context = "\n\n".join(c.content for c in chunks)

        elements = await self._generate_elements(context)

        row = GeneratedCanvas(
            paper_id=self.paper_id,
            section_index=self.section_index if self.section_index is not None else 0,
            mode=self.mode,
            elements_json=elements,
        )
        self.db.add(row)
        await self.db.flush()
        return row
