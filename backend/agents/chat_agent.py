"""ChatAgent — multi-modal research assistant chat with RAG.

Receives response_types[], dispatches in parallel:
  - 'text' → RAG retrieves top 5 simplified chunks → streams Claude
  - 'image' → extracts concept → ImageAgent.run_for_chat()
  - 'canvas' → extracts topic → CanvasAgent.run_for_chat()
  - 'video' → extracts concept → VideoAgent.run_for_chat()
Persists chat_messages with response_types and chat_assets.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from agents.canvas_agent import CanvasAgent
from agents.image_agent import ImageAgent
from agents.video_agent import VideoAgent
from db.models import ChatMessage
from prompts.chat import (
    CANVAS_SCOPE_SYSTEM,
    IMAGE_CONCEPT_SYSTEM,
    VIDEO_CONCEPT_SYSTEM,
    build_system,
)
from prompts.simplification import build_knowledge_summary
from services.bedrock import BedrockClient
from services.retrieval import retrieve_relevant_chunks


class ChatAgent:
    """Multi-modal chat agent for a paper."""

    def __init__(
        self,
        paper_id: uuid.UUID,
        session_id: str,
        paper_title: str,
        authors: list[str],
        profile_ratings: dict[str, bool],
        db_session: AsyncSession,
        bedrock: BedrockClient,
    ) -> None:
        self.paper_id = paper_id
        self.session_id = session_id
        self.paper_title = paper_title
        self.authors = authors
        self.profile_ratings = profile_ratings
        self.db = db_session
        self.bedrock = bedrock

    async def run(
        self,
        message: str,
        response_types: list[str],
    ) -> AsyncGenerator[dict, None]:
        """Process a chat message, yielding typed SSE events.

        Yields dicts like:
            {"event": "chat_text_delta", "data": {"delta": "..."}}
            {"event": "chat_image", "data": {"image_base64": "...", "caption": "..."}}
            {"event": "chat_canvas", "data": {"elements": [...]}}
            {"event": "chat_video_queued", "data": {"job_id": "...", "concept": "..."}}
            {"event": "chat_done", "data": {"message_id": "..."}}
        """
        # Save user message
        user_msg = ChatMessage(
            paper_id=self.paper_id,
            session_id=self.session_id,
            role="user",
            content=message,
            response_types=response_types,
        )
        self.db.add(user_msg)
        await self.db.flush()

        chat_assets: list[dict] = []
        full_text = ""

        # Text generation (streaming)
        if "text" in response_types:
            knowledge_summary = build_knowledge_summary(self.profile_ratings)

            chunks = await retrieve_relevant_chunks(
                query=message,
                paper_id=self.paper_id,
                source="simplified",
                top_k=5,
                db_session=self.db,
                bedrock_client=self.bedrock,
            )
            simplified_context = "\n\n---\n\n".join(
                f"[Section {c.section_index}, Chunk {c.chunk_index}]\n{c.content}"
                for c in chunks
            )

            system_prompt = build_system(
                self.paper_title,
                self.authors,
                knowledge_summary,
                simplified_context,
            )

            async for delta in self.bedrock.stream_claude(system_prompt, message):
                full_text += delta
                yield {"event": "chat_text_delta", "data": {"delta": delta}}

            yield {"event": "chat_text_done", "data": {}}

        # Dispatch media agents in parallel
        media_tasks: dict[str, asyncio.Task] = {}

        if "image" in response_types:
            concept = await self.bedrock.invoke_claude(
                IMAGE_CONCEPT_SYSTEM, message, max_tokens=100
            )
            concept = concept.strip()

            async def _gen_image(c: str = concept) -> dict:
                agent = ImageAgent(self.paper_id, c, self.db, self.bedrock)
                img = await agent.run_for_chat()
                return {
                    "id": str(img.id),
                    "paper_id": str(img.paper_id),
                    "concept": img.concept,
                    "image_base64": img.image_base64,
                    "caption": img.caption,
                    "seed": img.seed,
                }

            media_tasks["image"] = asyncio.create_task(_gen_image())

        if "canvas" in response_types:
            concept = await self.bedrock.invoke_claude(
                CANVAS_SCOPE_SYSTEM, message, max_tokens=100
            ) if "image" not in response_types else concept
            concept_name = concept.strip() if isinstance(concept, str) else "paper topic"

            async def _gen_canvas(c: str = concept_name) -> dict:
                agent = CanvasAgent(
                    self.paper_id, concept=c, mode="section",
                    db=self.db, bedrock=self.bedrock,
                )
                canvas = await agent.run_for_chat()
                return {
                    "id": str(canvas.id),
                    "paper_id": str(canvas.paper_id),
                    "section_index": canvas.section_index,
                    "mode": canvas.mode,
                    "elements_json": canvas.elements_json,
                    "caption": canvas.caption,
                }

            media_tasks["canvas"] = asyncio.create_task(_gen_canvas())

        if "video" in response_types:
            video_concept = await self.bedrock.invoke_claude(
                VIDEO_CONCEPT_SYSTEM, message, max_tokens=100
            )
            video_concept = video_concept.strip()

            async def _gen_video(c: str = video_concept) -> dict:
                agent = VideoAgent(self.paper_id, c, self.db, self.bedrock)
                vj = await agent.run_for_chat()
                return {
                    "id": str(vj.id),
                    "paper_id": str(vj.paper_id),
                    "concept": vj.concept,
                    "status": vj.status,
                    "mp4_path": vj.mp4_path,
                    "manim_script": None,
                    "error": vj.error,
                    "caption": vj.caption,
                    "created_at": str(vj.created_at) if vj.created_at else None,
                }

            media_tasks["video"] = asyncio.create_task(_gen_video())

        # Await all media tasks and yield results
        for media_type, task in media_tasks.items():
            try:
                result = await task
                if media_type == "image":
                    chat_assets.append({"type": "image", "asset_id": result["id"]})
                    yield {"event": "chat_image", "data": result}
                elif media_type == "canvas":
                    chat_assets.append({"type": "canvas", "asset_id": result["id"]})
                    yield {"event": "chat_canvas", "data": result}
                elif media_type == "video":
                    chat_assets.append({"type": "video", "asset_id": result["id"]})
                    yield {"event": "chat_video_queued", "data": result}
            except Exception:
                pass  # Fail-isolated: don't break chat for a media failure

        # Save assistant message
        assistant_msg = ChatMessage(
            paper_id=self.paper_id,
            session_id=self.session_id,
            role="assistant",
            content=full_text or "(media-only response)",
            response_types=response_types,
            chat_assets=chat_assets,
        )
        self.db.add(assistant_msg)
        await self.db.flush()

        yield {
            "event": "chat_done",
            "data": {
                "message_id": str(assistant_msg.id),
                "asset_ids": [a["asset_id"] for a in chat_assets],
            },
        }
