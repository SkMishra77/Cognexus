"""LabAgent — generates Jupyter notebooks for paper concepts.

Retrieves top 2 RAG chunks for each concept, asks Claude to generate a notebook
in nbformat v4 JSON, validates the notebook, and persists to generated_labs.
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone

import nbformat
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from db.models import AgentJob, GeneratedLab
from prompts.lab_generation import SYSTEM, build_user
from services.bedrock import BedrockClient
from services.retrieval import retrieve_relevant_chunks

logger = logging.getLogger(__name__)


def _parse_notebook_json(raw: str) -> dict:
    """Parse notebook JSON from Claude's response, handling markdown fences."""
    text = raw.strip()

    # Strip markdown fences
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    # Try direct parse
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    # Find first {...} block
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass

    logger.error("Failed to parse notebook JSON. First 500 chars: %r", text[:500])
    raise ValueError("Could not parse notebook JSON from response")


def _validate_notebook(nb_dict: dict) -> None:
    """Validate notebook structure using nbformat."""
    nb = nbformat.reads(json.dumps(nb_dict), as_version=4)
    nbformat.validate(nb)


class LabAgent:
    """Generates a Jupyter notebook for a single concept."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        concept: dict,
        profile_ratings: dict[str, bool],
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> None:
        self.paper_id = paper_id
        self.concept = concept
        self.profile_ratings = profile_ratings
        self.db = db_session
        self.bedrock = bedrock

    async def run(self) -> GeneratedLab:
        """Generate a lab notebook and persist it. Creates and updates an AgentJob."""
        concept_name = self.concept.get("name", "Unknown") if isinstance(self.concept, dict) else str(self.concept)
        difficulty = self.concept.get("difficulty", "intermediate") if isinstance(self.concept, dict) else "intermediate"

        return await self._run_inner(concept_name, difficulty)

    async def _run_inner(self, concept_name: str, difficulty: str) -> GeneratedLab:
        with self.db.no_autoflush:
            job = AgentJob(
                paper_id=self.paper_id,
                agent_type="lab",
                status="running",
                job_metadata={"phase": 1, "label": f"Lab: {concept_name}"},
            )
            self.db.add(job)
            await self.db.flush()

            try:
                job.job_metadata = {**(job.job_metadata or {}), "progress": "retrieving context"}
                flag_modified(job, "job_metadata")
                await self.db.flush()
                await self.db.commit()

                chunks = await retrieve_relevant_chunks(
                    query=concept_name,
                    paper_id=self.paper_id,
                    source="raw",
                    top_k=2,
                    db_session=self.db,
                    bedrock_client=self.bedrock,
                )
                context = "\n\n".join(c.content for c in chunks)

                from sqlalchemy import select
                from db.models import Paper

                paper_result = await self.db.execute(
                    select(Paper.title).where(Paper.id == self.paper_id)
                )
                paper_title = paper_result.scalar_one_or_none() or "Research Paper"

                job.job_metadata = {**(job.job_metadata or {}), "progress": "generating notebook"}
                flag_modified(job, "job_metadata")
                await self.db.flush()
                await self.db.commit()

                user_prompt = build_user(concept_name, paper_title, context, difficulty)

                nb_dict = None
                for attempt in range(2):
                    raw_response = await self.bedrock.invoke_claude(SYSTEM, user_prompt, max_tokens=16384)
                    try:
                        nb_dict = _parse_notebook_json(raw_response)
                        _validate_notebook(nb_dict)
                        break
                    except (ValueError, nbformat.ValidationError) as parse_err:
                        if attempt == 0:
                            logger.warning("Lab notebook parse failed (attempt 1), retrying: %s", parse_err)
                            user_prompt = (
                                f"{user_prompt}\n\n"
                                "IMPORTANT: Return ONLY raw JSON. No markdown fences, no explanation. "
                                "Start with {{ and end with }}. Must be valid nbformat v4."
                            )
                            continue
                        raise

                lab_title = f"{concept_name} Lab"
                cells = nb_dict.get("cells", [])
                for cell in cells:
                    if cell.get("cell_type") == "markdown":
                        source = cell.get("source", "")
                        if isinstance(source, list):
                            source = "".join(source)
                        if source.startswith("# "):
                            lab_title = source.split("\n")[0].lstrip("# ").strip()
                        break

                row = GeneratedLab(
                    paper_id=self.paper_id,
                    concept=concept_name,
                    title=lab_title,
                    notebook_json=nb_dict,
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
