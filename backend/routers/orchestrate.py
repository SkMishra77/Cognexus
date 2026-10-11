"""Orchestrate router — launches the two-phase agent pipeline for a paper."""

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.orchestrator import run_all_agents
from db.base import async_session, get_db
from db.models import AgentJob, KnowledgeProfile, Paper
from services.bedrock import BedrockClient

router = APIRouter(prefix="/orchestrate", tags=["orchestrate"])

_bedrock = BedrockClient()


class OrchestrateRequest(BaseModel):
    session_id: str
    ratings: dict[str, bool]


class OrchestrateResponse(BaseModel):
    message: str


async def _run_agents_background(
    paper_id: uuid.UUID,
    profile_ratings: dict[str, bool],
) -> None:
    """Background task that creates its own DB session."""
    async with async_session() as db:
        try:
            await run_all_agents(paper_id, profile_ratings, db, _bedrock)
        except Exception:
            pass  # Errors are recorded per-agent in agent_jobs table


@router.post("/{paper_id}", response_model=OrchestrateResponse)
async def orchestrate(
    paper_id: uuid.UUID,
    body: OrchestrateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Launch all agents for a paper based on the knowledge profile.

    Creates a KnowledgeProfile row and kicks off the two-phase orchestrator
    as a background task. Rejects duplicate runs.
    """
    paper_result = await db.execute(select(Paper).where(Paper.id == paper_id))
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    existing = await db.execute(
        select(AgentJob).where(
            AgentJob.paper_id == paper_id,
            AgentJob.status.in_(["running", "done"]),
        )
    )
    if existing.scalars().first() is not None:
        raise HTTPException(
            status_code=409, detail="Pipeline already running or completed for this paper"
        )

    profile = KnowledgeProfile(
        paper_id=paper_id,
        session_id=body.session_id,
        ratings_json=body.ratings,
    )
    db.add(profile)
    await db.commit()

    background_tasks.add_task(_run_agents_background, paper_id, body.ratings)

    return OrchestrateResponse(message="agents launched")
