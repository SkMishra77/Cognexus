"""VideoAgent — generates Manim scripts, validates, and enqueues rendering.

Retrieves top 2 RAG chunks for the concept, asks Claude to generate a Manim script,
validates with py_compile, creates a VideoJob in the DB, and enqueues rendering via RQ.
"""

import os
import py_compile
import re
import tempfile
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentJob, VideoJob
from prompts.manim_generation import SYSTEM, build_user
from services.bedrock import BedrockClient
from services.retrieval import retrieve_relevant_chunks


def _clean_script(raw: str) -> str:
    """Strip markdown fences if Claude wraps the script in them."""
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:]  # drop opening fence
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()


def _validate_script(script: str) -> None:
    """Validate that the script is syntactically correct Python using py_compile."""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(script)
        f.flush()
        tmp_path = f.name
    try:
        py_compile.compile(tmp_path, doraise=True)
    finally:
        os.unlink(tmp_path)


class VideoAgent:
    """Generates a Manim animation script for a concept and enqueues rendering."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        concept_name: str,
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> None:
        self.paper_id = paper_id
        self.concept_name = concept_name
        self.db = db_session
        self.bedrock = bedrock

    async def run(self) -> VideoJob:
        """Generate Manim script, validate, persist, and enqueue rendering."""
        job = AgentJob(
            paper_id=self.paper_id,
            agent_type="video",
            status="running",
        )
        self.db.add(job)
        await self.db.flush()

        try:
            chunks = await retrieve_relevant_chunks(
                query=self.concept_name,
                paper_id=self.paper_id,
                source="simplified",
                top_k=2,
                db_session=self.db,
                bedrock_client=self.bedrock,
            )
            context = "\n\n".join(c.content for c in chunks)

            user_prompt = build_user(self.concept_name, context=context)
            raw_script = await self.bedrock.invoke_claude(SYSTEM, user_prompt, max_tokens=8192)
            script = _clean_script(raw_script)

            _validate_script(script)

            video_job = VideoJob(
                paper_id=self.paper_id,
                concept=self.concept_name,
                status="queued",
                manim_script=script,
            )
            self.db.add(video_job)
            await self.db.flush()

            # Enqueue RQ job for rendering
            try:
                from redis import Redis
                from rq import Queue

                redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
                redis_conn = Redis.from_url(redis_url)
                q = Queue(connection=redis_conn)
                q.enqueue(
                    "workers.video_worker.render_manim",
                    str(video_job.id),
                    script,
                    job_timeout=300,
                )
            except Exception:
                # If Redis/RQ is unavailable, the job stays "queued" in DB
                pass

            job.status = "done"
            job.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            return video_job

        except Exception as e:
            job.status = "failed"
            job.error = str(e)[:2000]
            job.completed_at = datetime.now(timezone.utc)
            await self.db.flush()
            raise

    async def run_for_chat(self) -> VideoJob:
        """Convenience wrapper for chat-initiated video generation (no agent job row)."""
        chunks = await retrieve_relevant_chunks(
            query=self.concept_name,
            paper_id=self.paper_id,
            source="simplified",
            top_k=2,
            db_session=self.db,
            bedrock_client=self.bedrock,
        )
        context = "\n\n".join(c.content for c in chunks)

        user_prompt = build_user(self.concept_name, context=context)
        raw_script = await self.bedrock.invoke_claude(SYSTEM, user_prompt, max_tokens=8192)
        script = _clean_script(raw_script)

        _validate_script(script)

        video_job = VideoJob(
            paper_id=self.paper_id,
            concept=self.concept_name,
            status="queued",
            manim_script=script,
        )
        self.db.add(video_job)
        await self.db.flush()

        # Enqueue RQ job
        try:
            from redis import Redis
            from rq import Queue

            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            redis_conn = Redis.from_url(redis_url)
            q = Queue(connection=redis_conn)
            q.enqueue(
                "workers.video_worker.render_manim",
                str(video_job.id),
                script,
                job_timeout=300,
            )
        except Exception:
            pass

        return video_job
