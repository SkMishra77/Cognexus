"""Ingest router — PDF upload, arXiv URL, and concept extraction endpoints.

Handles deduplication via fingerprints (arXiv ID > DOI > SHA-256),
RAG chunk embedding on ingest, and concept extraction via map-reduce.
"""

import hashlib
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agents.concept_extractor import ConceptExtractor
from db.base import get_db
from db.models import Chunk, Concept, Paper, PaperSection
from services.arxiv import fetch_arxiv_paper, parse_arxiv_id
from services.bedrock import BedrockClient
from services.chunker import chunk_text
from services.pdf_parser import parse_pdf

router = APIRouter(prefix="/ingest", tags=["ingest"])

MAX_PDF_SIZE = 50 * 1024 * 1024  # 50 MB

_bedrock = BedrockClient()


# ── Request / Response schemas ───────────────────────────────────────────────

class ArxivRequest(BaseModel):
    url: str


class IngestResponse(BaseModel):
    paper_id: str
    title: str
    authors: list[str] = []
    section_count: int = 0
    cached: bool


class ConceptOut(BaseModel):
    name: str
    description: str
    difficulty: str | None = None
    related_concepts: list[str] = []


class ConceptsResponse(BaseModel):
    concepts: list[ConceptOut]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sha256_fingerprint(text: str) -> str:
    return f"sha256:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"


async def _find_by_fingerprint(
    fingerprint: str, db: AsyncSession
) -> Paper | None:
    result = await db.execute(
        select(Paper).where(Paper.fingerprint == fingerprint)
    )
    return result.scalar_one_or_none()


async def _store_paper(
    *,
    title: str,
    authors: list[str],
    abstract: str | None,
    year: int | None,
    source: str | None,
    raw_text: str,
    fingerprint: str,
    doi: str | None,
    sections: list[dict],
    db: AsyncSession,
) -> Paper:
    """Create Paper + PaperSection rows."""
    paper = Paper(
        title=title,
        authors=authors,
        abstract=abstract,
        year=year,
        source=source,
        raw_text=raw_text,
        fingerprint=fingerprint,
        doi=doi,
    )
    db.add(paper)
    await db.flush()  # get paper.id

    for sec in sections:
        db.add(
            PaperSection(
                paper_id=paper.id,
                index=sec["index"],
                title=sec.get("title"),
                raw_text=sec["raw_text"],
            )
        )

    return paper


async def _chunk_embed_store(
    paper_id: uuid.UUID,
    raw_text: str,
    db: AsyncSession,
) -> int:
    """Chunk text, embed all chunks in parallel, store in chunks table.

    Returns the number of chunks created.
    """
    chunks = chunk_text(raw_text)
    if not chunks:
        return 0

    embeddings = await _bedrock.embed_batch(chunks)

    for i, (chunk_content, embedding) in enumerate(zip(chunks, embeddings)):
        db.add(
            Chunk(
                paper_id=paper_id,
                source="raw",
                chunk_index=i,
                content=chunk_content,
                embedding=embedding,
                token_count=len(chunk_content) // 4,
            )
        )

    return len(chunks)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/pdf", response_model=IngestResponse)
async def ingest_pdf(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Ingest a PDF file upload with dedup and RAG indexing."""
    file_bytes = await file.read()

    if len(file_bytes) > MAX_PDF_SIZE:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    parsed = await parse_pdf(file_bytes)
    full_text = parsed["full_text"]
    doi = parsed["doi"]

    # Compute fingerprint: DOI > SHA-256
    if doi:
        fingerprint = f"doi:{doi}"
    else:
        fingerprint = _sha256_fingerprint(full_text)

    # Dedup check
    existing = await _find_by_fingerprint(fingerprint, db)
    if existing:
        section_count = await db.execute(
            select(PaperSection).where(PaperSection.paper_id == existing.id)
        )
        sections = section_count.scalars().all()
        return IngestResponse(
            paper_id=str(existing.id),
            title=existing.title,
            authors=existing.authors or [],
            section_count=len(sections),
            cached=True,
        )

    # Derive title from first section heading or filename
    title = "Untitled Paper"
    if parsed["sections"] and parsed["sections"][0].get("title"):
        title = parsed["sections"][0]["title"]
    elif file.filename:
        title = file.filename.removesuffix(".pdf")

    paper = await _store_paper(
        title=title,
        authors=[],
        abstract=None,
        year=None,
        source="pdf_upload",
        raw_text=full_text,
        fingerprint=fingerprint,
        doi=doi,
        sections=parsed["sections"],
        db=db,
    )

    await _chunk_embed_store(paper.id, full_text, db)
    await db.commit()

    return IngestResponse(
        paper_id=str(paper.id),
        title=paper.title,
        authors=paper.authors or [],
        section_count=len(parsed["sections"]),
        cached=False,
    )


@router.post("/arxiv", response_model=IngestResponse)
async def ingest_arxiv(
    body: ArxivRequest,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a paper from an arXiv URL with dedup and RAG indexing."""
    try:
        arxiv_id = parse_arxiv_id(body.url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid arXiv URL")

    fingerprint = f"arxiv:{arxiv_id}"

    # Dedup check
    existing = await _find_by_fingerprint(fingerprint, db)
    if existing:
        section_count = await db.execute(
            select(PaperSection).where(PaperSection.paper_id == existing.id)
        )
        sections = section_count.scalars().all()
        return IngestResponse(
            paper_id=str(existing.id),
            title=existing.title,
            authors=existing.authors or [],
            section_count=len(sections),
            cached=True,
        )

    # Fetch metadata + PDF concurrently
    try:
        metadata, pdf_bytes = await fetch_arxiv_paper(body.url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch from arXiv: {e}")

    parsed = await parse_pdf(pdf_bytes)

    paper = await _store_paper(
        title=metadata.get("title", "Untitled"),
        authors=metadata.get("authors", []),
        abstract=metadata.get("abstract"),
        year=metadata.get("year"),
        source="arxiv",
        raw_text=parsed["full_text"],
        fingerprint=fingerprint,
        doi=metadata.get("doi") or parsed["doi"],
        sections=parsed["sections"],
        db=db,
    )

    await _chunk_embed_store(paper.id, parsed["full_text"], db)
    await db.commit()

    return IngestResponse(
        paper_id=str(paper.id),
        title=paper.title,
        authors=paper.authors or [],
        section_count=len(parsed["sections"]),
        cached=False,
    )


@router.get("/concepts/{paper_id}", response_model=ConceptsResponse)
async def get_concepts(
    paper_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get concepts for a paper. Extracts them on first request if needed."""
    # Check if concepts already exist
    result = await db.execute(
        select(Concept).where(Concept.paper_id == paper_id)
    )
    existing_concepts = result.scalars().all()

    if existing_concepts:
        return ConceptsResponse(
            concepts=[
                ConceptOut(
                    name=c.name,
                    description=c.description,
                    difficulty=c.difficulty,
                    related_concepts=c.related_concepts or [],
                )
                for c in existing_concepts
            ]
        )

    # Verify paper exists
    paper_result = await db.execute(
        select(Paper).where(Paper.id == paper_id)
    )
    if paper_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Run concept extraction
    extractor = ConceptExtractor()
    concepts = await extractor.run(paper_id, db, _bedrock)

    return ConceptsResponse(
        concepts=[
            ConceptOut(
                name=c.get("name", ""),
                description=c.get("description", ""),
                difficulty=c.get("difficulty"),
                related_concepts=c.get("related_concepts", []),
            )
            for c in concepts
        ]
    )
