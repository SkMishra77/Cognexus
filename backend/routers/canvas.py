"""Canvas router — manual canvas generation endpoint."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.canvas_agent import CanvasAgent
from db.base import get_db
from db.models import Paper
from services.bedrock import BedrockClient

router = APIRouter(prefix="/canvas", tags=["canvas"])

_bedrock = BedrockClient()


class GenerateCanvasRequest(BaseModel):
    paper_id: uuid.UUID
    section_index: int = 0
    concept: str


class CanvasResponse(BaseModel):
    id: str
    section_index: int
    mode: str
    elements: list | dict | None = None


@router.post("/generate-manual", response_model=CanvasResponse)
async def generate_manual_canvas(
    body: GenerateCanvasRequest,
    db: AsyncSession = Depends(get_db),
):
    """User-requested canvas for a specific concept/section."""
    paper_result = await db.execute(
        select(Paper).where(Paper.id == body.paper_id)
    )
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    agent = CanvasAgent(
        paper_id=body.paper_id,
        section_index=body.section_index,
        concept=body.concept,
        mode="section",
        db=db,
        bedrock=_bedrock,
    )
    try:
        canvas = await agent.run_for_chat()
        await db.commit()
        return CanvasResponse(
            id=str(canvas.id),
            section_index=canvas.section_index,
            mode=canvas.mode or "section",
            elements=canvas.elements_json,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:500])
