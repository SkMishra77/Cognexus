"""ImageAgent — generates educational images for paper concepts.

Retrieves top 2 RAG chunks for the concept, asks Claude to write an image prompt,
calls Bedrock image generation, and persists the result to generated_images.
"""

import base64
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from db.models import AgentJob, GeneratedImage
from prompts.image_generation import PROMPT_SYSTEM, build_prompt_request
from services.bedrock import BedrockClient
from services.retrieval import retrieve_relevant_chunks


class ImageAgent:
    """Generates an educational image for a single concept."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        concept_name: str,
        db_session: AsyncSession,
        bedrock: BedrockClient,
        seed: int = 42,
    ) -> None:
        self.paper_id = paper_id
        self.concept_name = concept_name
        self.db = db_session
        self.bedrock = bedrock
        self.seed = seed

    async def run(self) -> GeneratedImage:
        """Generate an image and persist it. Creates and updates an AgentJob."""
        job = AgentJob(
            paper_id=self.paper_id,
            agent_type="image",
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

            user_prompt = build_prompt_request(self.concept_name, context)
            image_prompt = await self.bedrock.invoke_claude(
                PROMPT_SYSTEM, user_prompt, max_tokens=1024
            )
            image_prompt = image_prompt.strip()

            image_bytes = await self.bedrock.generate_image(image_prompt, seed=self.seed)
            image_b64 = base64.b64encode(image_bytes).decode("utf-8")

            row = GeneratedImage(
                paper_id=self.paper_id,
                concept=self.concept_name,
                image_base64=image_b64,
                caption=image_prompt,
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

        user_prompt = build_prompt_request(self.concept_name, context)
        image_prompt = await self.bedrock.invoke_claude(
            PROMPT_SYSTEM, user_prompt, max_tokens=1024
        )
        image_prompt = image_prompt.strip()

        image_bytes = await self.bedrock.generate_image(image_prompt, seed=self.seed)
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        row = GeneratedImage(
            paper_id=self.paper_id,
            concept=self.concept_name,
            image_base64=image_b64,
            caption=image_prompt,
            seed=self.seed,
        )
        self.db.add(row)
        await self.db.flush()
        return row
