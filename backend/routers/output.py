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

        while True:
            result = await db.execute(
                select(AgentJob).where(AgentJob.paper_id == paper_id)
            )
            jobs = result.scalars().all()

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
                                "section_index": canvas.section_index,
                                "mode": canvas.mode,
                                "elements": canvas.elements_json,
                            }),
                        }

                elif job.agent_type == "video":
                    vj_result = await db.execute(
                        select(VideoJob).where(VideoJob.paper_id == paper_id)
                    )
                    for vj in vj_result.scalars().all():
                        if vj.status == "done" and vj.mp4_path:
                            yield {
                                "event": "video_done",
                                "data": _serialize({
                                    "job_id": str(vj.id),
                                    "concept": vj.concept,
                                    "mp4_url": vj.mp4_path,
                                }),
                            }
                        else:
                            yield {
                                "event": "video_queued",
                                "data": _serialize({
                                    "job_id": str(vj.id),
                                    "concept": vj.concept,
                                    "status": vj.status,
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
            "section_index": c.section_index,
            "mode": c.mode,
            "elements": c.elements_json,
        }
        for c in cv_result.scalars().all()
    ]

    # Video jobs
    vj_result = await db.execute(
        select(VideoJob).where(VideoJob.paper_id == paper_id)
    )
    videos = [
        {
            "job_id": str(vj.id),
            "concept": vj.concept,
            "status": vj.status,
            "mp4_url": vj.mp4_path,
            "error": vj.error,
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
            "error": j.error,
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
