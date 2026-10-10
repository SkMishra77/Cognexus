"""Images router — regenerate and manual image generation endpoints."""

import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.image_agent import ImageAgent
from db.base import get_db
from db.models import GeneratedImage, Paper
from services.bedrock import BedrockClient

router = APIRouter(prefix="/images", tags=["images"])

_bedrock = BedrockClient()


class RegenerateRequest(BaseModel):
    paper_id: uuid.UUID
    concept: str
    seed: int | None = None


class GenerateManualRequest(BaseModel):
    paper_id: uuid.UUID
    concept: str
    context: str = ""


class ImageResponse(BaseModel):
    id: str
    image_base64: str
    caption: str | None = None
    seed: int | None = None


@router.post("/regenerate", response_model=ImageResponse)
async def regenerate_image(
    body: RegenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Regenerate an image for a concept with a new seed."""
    paper_result = await db.execute(
        select(Paper).where(Paper.id == body.paper_id)
    )
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    import random
    seed = body.seed if body.seed is not None else random.randint(1, 999999)

    agent = ImageAgent(body.paper_id, body.concept, db, _bedrock, seed=seed)
    try:
        img = await agent.run_for_chat()
        await db.commit()
        return ImageResponse(
            id=str(img.id),
            image_base64=img.image_base64,
            caption=img.caption,
            seed=img.seed,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:500])


@router.post("/generate-manual", response_model=ImageResponse)
async def generate_manual_image(
    body: GenerateManualRequest,
    db: AsyncSession = Depends(get_db),
):
    """User-requested image for any concept (not driven by media_plan)."""
    paper_result = await db.execute(
        select(Paper).where(Paper.id == body.paper_id)
    )
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    agent = ImageAgent(body.paper_id, body.concept, db, _bedrock)
    try:
        img = await agent.run_for_chat()
        await db.commit()
        return ImageResponse(
            id=str(img.id),
            image_base64=img.image_base64,
            caption=img.caption,
            seed=img.seed,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:500])
