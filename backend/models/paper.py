from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PaperCreate(BaseModel):
    title: str
    authors: list[str] = []
    abstract: str | None = None
    year: int | None = None
    source: str | None = None


class PaperResponse(BaseModel):
    id: UUID
    title: str
    authors: list[str]
    abstract: str | None
    year: int | None
    source: str | None
    fingerprint: str
    doi: str | None
    created_at: datetime
    cached: bool = False

    model_config = {"from_attributes": True}


class PaperSectionResponse(BaseModel):
    id: UUID
    paper_id: UUID
    index: int
    title: str | None
    raw_text: str

    model_config = {"from_attributes": True}


class IngestResponse(BaseModel):
    paper_id: UUID
    cached: bool
