"""Video router — manual video generation and status polling endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.video_agent import VideoAgent
from db.base import get_db
from db.models import Paper, VideoJob
from services.bedrock import BedrockClient

router = APIRouter(prefix="/video", tags=["video"])

_bedrock = BedrockClient()


class GenerateVideoRequest(BaseModel):
    paper_id: uuid.UUID
    concept: str
    equation: str | None = None


class VideoQueuedResponse(BaseModel):
    job_id: str
    status: str


class VideoStatusResponse(BaseModel):
    job_id: str
    concept: str
    status: str
    mp4_url: str | None = None
    error: str | None = None


@router.post("/generate-manual", response_model=VideoQueuedResponse)
async def generate_manual_video(
    body: GenerateVideoRequest,
    db: AsyncSession = Depends(get_db),
):
    """User-requested video for a concept (not driven by media_plan)."""
    paper_result = await db.execute(
        select(Paper).where(Paper.id == body.paper_id)
    )
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    agent = VideoAgent(body.paper_id, body.concept, db, _bedrock)
    try:
        video_job = await agent.run_for_chat()
        await db.commit()
        return VideoQueuedResponse(
            job_id=str(video_job.id),
            status=video_job.status,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:500])


@router.get("/status/{job_id}", response_model=VideoStatusResponse)
async def video_status(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get the current status of a video rendering job."""
    result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    vj = result.scalar_one_or_none()
    if vj is None:
        raise HTTPException(status_code=404, detail="Video job not found")

    return VideoStatusResponse(
        job_id=str(vj.id),
        concept=vj.concept,
        status=vj.status,
        mp4_url=vj.mp4_path,
        error=vj.error,
    )
