from uuid import UUID

from pydantic import BaseModel


class ConceptResponse(BaseModel):
    id: UUID
    paper_id: UUID
    name: str
    description: str
    difficulty: str | None
    related_concepts: list[str] | None

    model_config = {"from_attributes": True}


class KnowledgeRating(BaseModel):
    concept_name: str
    rating: str  # "yes" | "no"


class KnowledgeProfileCreate(BaseModel):
    paper_id: UUID
    session_id: str
    ratings: list[KnowledgeRating]


class KnowledgeProfileResponse(BaseModel):
    id: UUID
    paper_id: UUID
    session_id: str
    ratings_json: dict

    model_config = {"from_attributes": True}
