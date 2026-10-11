"""Output router — SSE stream and snapshot endpoints for agent results."""

import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from db.base import get_db
from db.models import (
    AgentJob,
    GeneratedCanvas,
    GeneratedImage,
    GeneratedLab,
    Paper,
    SimplifiedSection,
    VideoJob,
    WebSearchResult,
)

router = APIRouter(prefix="/output", tags=["output"])


def _serialize(obj: dict | list | str) -> str:
    """JSON-serialize for SSE data field."""
    if isinstance(obj, str):
        return obj
    return json.dumps(obj, default=str)


@router.get("/papers", tags=["papers"])
async def list_papers(db: AsyncSession = Depends(get_db)):
    """List all papers."""
    result = await db.execute(
        select(Paper).order_by(Paper.created_at.desc())
    )
    papers = result.scalars().all()
    return {
        "papers": [
            {
                "id": str(p.id),
                "title": p.title,
                "authors": p.authors or [],
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in papers
        ]
    }


@router.get("/papers/{paper_id}", tags=["papers"])
async def get_paper(
    paper_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single paper's detail."""
    result = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = result.scalar_one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    return {
        "id": str(paper.id),
        "title": paper.title,
        "authors": paper.authors or [],
        "abstract": paper.abstract,
        "year": paper.year,
        "source": paper.source,
        "fingerprint": paper.fingerprint,
        "doi": paper.doi,
        "created_at": paper.created_at.isoformat() if paper.created_at else None,
    }


@router.get("/{paper_id}/agents")
async def get_agent_jobs(
    paper_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return current agent job statuses for a paper."""
    result = await db.execute(
        select(AgentJob)
        .where(AgentJob.paper_id == paper_id)
        .order_by(AgentJob.created_at)
    )
    jobs = result.scalars().all()
    return {
        "agents": [
            {
                "id": str(j.id),
                "agent_type": j.agent_type,
                "status": j.status,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                "error": j.error[:200] if j.error else None,
                "metadata": j.job_metadata,
            }
            for j in jobs
        ]
    }


@router.get("/{paper_id}/stream")
async def output_stream(
    paper_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """SSE endpoint that polls agent_jobs table every 1 second.

    For each completed job, fetches its output from the relevant table
    and emits a typed event. Ends with a 'complete' event once all jobs
    are done or failed.
    """
    paper_result = await db.execute(select(Paper).where(Paper.id == paper_id))
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    async def event_generator():
        seen_jobs: set[uuid.UUID] = set()
        last_agent_snapshot: list[dict] = []
        heartbeat_counter = 0

        while True:
            # Expire cached ORM objects so we read fresh status from DB.
            # Without this, expire_on_commit=False causes stale reads
            # since agents commit in a separate session.
            db.expire_all()

            result = await db.execute(
                select(AgentJob).where(AgentJob.paper_id == paper_id)
            )
            jobs = result.scalars().all()

            agent_snapshot = [
                {
                    "id": str(j.id),
                    "agent_type": j.agent_type,
                    "status": j.status,
                    "created_at": j.created_at.isoformat() if j.created_at else None,
                    "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                    "error": j.error[:200] if j.error else None,
                    "metadata": j.job_metadata,
                }
                for j in jobs
            ]
            if agent_snapshot != last_agent_snapshot:
                last_agent_snapshot = agent_snapshot
                yield {
                    "event": "agent_status",
                    "data": _serialize(agent_snapshot),
                }

            for job in jobs:
                if job.id in seen_jobs:
                    continue
                if job.status not in ("done", "failed"):
                    continue

                seen_jobs.add(job.id)

                if job.status == "failed":
                    yield {
                        "event": job.agent_type,
                        "data": _serialize({
                            "status": "failed",
                            "error": job.error,
                            "agent_type": job.agent_type,
                        }),
                    }
                    continue

                # Fetch output based on agent type
                if job.agent_type == "simplification":
                    ss_result = await db.execute(
                        select(SimplifiedSection)
                        .where(SimplifiedSection.paper_id == paper_id)
                        .order_by(SimplifiedSection.section_index)
                    )
                    for section in ss_result.scalars().all():
                        yield {
                            "event": "simplification",
                            "data": _serialize({
                                "id": str(section.id),
                                "section_index": section.section_index,
                                "title": section.title,
                                "simplified_text": section.simplified_text,
                                "key_concepts": section.key_concepts,
                                "equations": section.equations,
                                "media_plan": section.media_plan,
                            }),
                        }

                elif job.agent_type == "image":
                    img_result = await db.execute(
                        select(GeneratedImage)
                        .where(GeneratedImage.paper_id == paper_id)
                        .order_by(GeneratedImage.concept)
                    )
                    for img in img_result.scalars().all():
                        yield {
                            "event": "image",
                            "data": _serialize({
                                "id": str(img.id),
                                "concept": img.concept,
                                "image_base64": img.image_base64,
                                "caption": img.caption,
                                "seed": img.seed,
                            }),
                        }

                elif job.agent_type == "canvas":
                    cv_result = await db.execute(
                        select(GeneratedCanvas)
                        .where(GeneratedCanvas.paper_id == paper_id)
                    )
                    for canvas in cv_result.scalars().all():
                        yield {
                            "event": "canvas",
                            "data": _serialize({
                                "id": str(canvas.id),
                                "paper_id": str(canvas.paper_id),
                                "section_index": canvas.section_index,
                                "mode": canvas.mode,
                                "elements_json": canvas.elements_json,
                                "caption": canvas.caption,
                            }),
                        }

                elif job.agent_type == "video":
                    vj_result = await db.execute(
                        select(VideoJob).where(VideoJob.paper_id == paper_id)
                    )
                    for vj in vj_result.scalars().all():
                        yield {
                            "event": vj.status == "done" and vj.mp4_path and "video_done" or "video_queued",
                            "data": _serialize({
                                "id": str(vj.id),
                                "paper_id": str(vj.paper_id),
                                "concept": vj.concept,
                                "status": vj.status,
                                "mp4_path": vj.mp4_path,
                                "error": vj.error,
                                "caption": vj.caption,
                                "created_at": vj.created_at.isoformat() if vj.created_at else None,
                            }),
                        }

                elif job.agent_type == "lab":
                    lab_result = await db.execute(
                        select(GeneratedLab)
                        .where(GeneratedLab.paper_id == paper_id)
                    )
                    for lab in lab_result.scalars().all():
                        yield {
                            "event": "lab",
                            "data": _serialize({
                                "id": str(lab.id),
                                "concept": lab.concept,
                                "title": lab.title,
                            }),
                        }

                elif job.agent_type == "research":
                    ws_result = await db.execute(
                        select(WebSearchResult)
                        .where(WebSearchResult.paper_id == paper_id)
                        .order_by(WebSearchResult.concept, WebSearchResult.created_at)
                    )
                    for ws in ws_result.scalars().all():
                        yield {
                            "event": "research",
                            "data": _serialize({
                                "id": str(ws.id),
                                "concept": ws.concept,
                                "title": ws.title,
                                "url": ws.url,
                                "snippet": ws.snippet,
                            }),
                        }

            # Check if all jobs are terminal
            if jobs and all(j.status in ("done", "failed") for j in jobs):
                total = len(jobs)
                failed = sum(1 for j in jobs if j.status == "failed")
                yield {
                    "event": "complete",
                    "data": _serialize({
                        "total_agents": total,
                        "failed_agents": failed,
                    }),
                }
                break

            # Heartbeat every ~15s keeps proxies and browsers from
            # dropping the SSE connection during long agent runs.
            heartbeat_counter += 1
            if heartbeat_counter % 15 == 0:
                running = [j for j in jobs if j.status == "running"]
                yield {
                    "event": "heartbeat",
                    "data": _serialize({
                        "running_agents": len(running),
                        "total_agents": len(jobs),
                        "labels": [
                            (j.job_metadata or {}).get("label", j.agent_type)
                            for j in running
                        ],
                    }),
                }

            await asyncio.sleep(1)

    return EventSourceResponse(event_generator())


@router.get("/{paper_id}")
async def output_snapshot(
    paper_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return full snapshot of all completed outputs for a paper (page reload)."""
    paper_result = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = paper_result.scalar_one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Simplified sections
    ss_result = await db.execute(
        select(SimplifiedSection)
        .where(SimplifiedSection.paper_id == paper_id)
        .order_by(SimplifiedSection.section_index)
    )
    simplified = [
        {
            "id": str(s.id),
            "section_index": s.section_index,
            "title": s.title,
            "simplified_text": s.simplified_text,
            "key_concepts": s.key_concepts,
            "equations": s.equations,
            "media_plan": s.media_plan,
        }
        for s in ss_result.scalars().all()
    ]

    # Images
    img_result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.paper_id == paper_id)
    )
    images = [
        {
            "id": str(img.id),
            "concept": img.concept,
            "image_base64": img.image_base64,
            "caption": img.caption,
            "seed": img.seed,
        }
        for img in img_result.scalars().all()
    ]

    # Canvases
    cv_result = await db.execute(
        select(GeneratedCanvas).where(GeneratedCanvas.paper_id == paper_id)
    )
    canvases = [
        {
            "id": str(c.id),
            "paper_id": str(c.paper_id),
            "section_index": c.section_index,
            "mode": c.mode,
            "elements_json": c.elements_json,
            "caption": c.caption,
        }
        for c in cv_result.scalars().all()
    ]

    # Video jobs
    vj_result = await db.execute(
        select(VideoJob).where(VideoJob.paper_id == paper_id)
    )
    videos = [
        {
            "id": str(vj.id),
            "paper_id": str(vj.paper_id),
            "concept": vj.concept,
            "status": vj.status,
            "mp4_path": vj.mp4_path,
            "manim_script": None,
            "error": vj.error,
            "caption": vj.caption,
            "created_at": vj.created_at.isoformat() if vj.created_at else None,
        }
        for vj in vj_result.scalars().all()
    ]

    # Labs
    lab_result = await db.execute(
        select(GeneratedLab).where(GeneratedLab.paper_id == paper_id)
    )
    labs = [
        {
            "id": str(lab.id),
            "concept": lab.concept,
            "title": lab.title,
        }
        for lab in lab_result.scalars().all()
    ]

    # Web search results (research agent)
    ws_result = await db.execute(
        select(WebSearchResult)
        .where(WebSearchResult.paper_id == paper_id)
        .order_by(WebSearchResult.concept, WebSearchResult.created_at)
    )
    web_search_results = [
        {
            "id": str(ws.id),
            "concept": ws.concept,
            "title": ws.title,
            "url": ws.url,
            "snippet": ws.snippet,
        }
        for ws in ws_result.scalars().all()
    ]

    # Agent jobs summary
    job_result = await db.execute(
        select(AgentJob).where(AgentJob.paper_id == paper_id)
    )
    jobs = [
        {
            "id": str(j.id),
            "agent_type": j.agent_type,
            "status": j.status,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
            "error": j.error,
            "metadata": j.job_metadata,
        }
        for j in job_result.scalars().all()
    ]

    return {
        "paper_id": str(paper_id),
        "simplified_sections": simplified,
        "images": images,
        "canvases": canvases,
        "videos": videos,
        "labs": labs,
        "web_search_results": web_search_results,
        "agent_jobs": jobs,
    }
