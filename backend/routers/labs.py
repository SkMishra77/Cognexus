"""Labs router — ZIP download and individual notebook download endpoints."""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.base import get_db
from db.models import GeneratedLab, Paper
from services.zip_builder import build_labs_zip

router = APIRouter(prefix="/labs", tags=["labs"])


@router.get("/{paper_id}/download")
async def download_labs_zip(
    paper_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Download all labs for a paper as a ZIP archive."""
    paper_result = await db.execute(select(Paper).where(Paper.id == paper_id))
    paper = paper_result.scalar_one_or_none()
    if paper is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    lab_result = await db.execute(
        select(GeneratedLab).where(GeneratedLab.paper_id == paper_id)
    )
    labs = lab_result.scalars().all()

    if not labs:
        raise HTTPException(status_code=404, detail="No labs found for this paper")

    zip_bytes = build_labs_zip(list(labs), paper.title)

    safe_title = paper.title.replace(" ", "_")[:50]
    filename = f"{safe_title}_labs.zip"

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/{paper_id}/{lab_id}/download")
async def download_single_lab(
    paper_id: uuid.UUID,
    lab_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Download a single lab notebook as .ipynb."""
    result = await db.execute(
        select(GeneratedLab)
        .where(GeneratedLab.id == lab_id)
        .where(GeneratedLab.paper_id == paper_id)
    )
    lab = result.scalar_one_or_none()
    if lab is None:
        raise HTTPException(status_code=404, detail="Lab not found")

    import nbformat

    try:
        nb = nbformat.reads(json.dumps(lab.notebook_json), as_version=4)
        content = nbformat.writes(nb)
    except Exception:
        content = json.dumps(lab.notebook_json, indent=2)

    safe_concept = lab.concept.replace(" ", "_")[:50]
    filename = f"{safe_concept}_lab.ipynb"

    return Response(
        content=content.encode("utf-8"),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
