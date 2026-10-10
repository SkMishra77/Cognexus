"""Chat router — SSE endpoint for multi-modal research assistant chat."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from agents.chat_agent import ChatAgent
from db.base import get_db
from db.models import KnowledgeProfile, Paper
from services.bedrock import BedrockClient

router = APIRouter(prefix="/chat", tags=["chat"])

_bedrock = BedrockClient()


class ChatRequest(BaseModel):
    session_id: str
    message: str
    response_types: list[str] = ["text"]


@router.post("/{paper_id}")
async def chat(
    paper_id: uuid.UUID,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """SSE endpoint streaming typed events for multi-modal chat.

    Events:
        chat_text_delta — streamed text tokens
        chat_text_done — text generation complete
        chat_image — generated image data
        chat_canvas — generated canvas elements
        chat_video_queued — video job queued for rendering
        chat_done — all response types complete
    """
    # Validate response_types
    valid_types = {"text", "image", "canvas", "video"}
    if not body.response_types:
        raise HTTPException(status_code=400, detail="At least one response_type required")
    for rt in body.response_types:
        if rt not in valid_types:
            raise HTTPException(status_code=400, detail=f"Invalid response_type: {rt}")

    # Fetch paper
    paper_result = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = paper_result.scalar_one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Get knowledge profile for this session
    profile_result = await db.execute(
        select(KnowledgeProfile)
        .where(KnowledgeProfile.paper_id == paper_id)
        .where(KnowledgeProfile.session_id == body.session_id)
        .order_by(KnowledgeProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    profile_ratings: dict[str, bool] = {}
    if profile:
        profile_ratings = profile.ratings_json or {}

    agent = ChatAgent(
        paper_id=paper_id,
        session_id=body.session_id,
        paper_title=paper.title,
        authors=paper.authors or [],
        profile_ratings=profile_ratings,
        db_session=db,
        bedrock=_bedrock,
    )

    async def event_generator():
        try:
            async for event in agent.run(body.message, body.response_types):
                yield {
                    "event": event["event"],
                    "data": json.dumps(event["data"], default=str),
                }
            await db.commit()
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)[:500]}),
            }

    return EventSourceResponse(event_generator())
