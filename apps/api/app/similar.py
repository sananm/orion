from fastapi import APIRouter
from pydantic import BaseModel, Field

from .index_store import get_store

router = APIRouter()


class SimilarRequest(BaseModel):
    movieId: int
    k: int = Field(default=5, ge=1, le=20)
    likedIds: list[int] = Field(default_factory=list)
    dislikedIds: list[int] = Field(default_factory=list)
    excludeIds: list[int] = Field(default_factory=list)
    alpha: float = 0.3
    beta: float = 0.5
    language: str | None = None
    languages: list[str] = Field(default_factory=list)
    minRating: float | None = Field(default=None, ge=0, le=10)
    yearFrom: int | None = Field(default=None, ge=1888, le=2100)
    yearTo: int | None = Field(default=None, ge=1888, le=2100)


@router.post("/similar")
def similar(req: SimilarRequest):
    languages = [language.strip() for language in req.languages if language.strip()]
    if not languages and req.language:
        languages = [req.language.strip()]
    results = get_store().similar(
        movie_id=req.movieId,
        k=req.k,
        liked_ids=req.likedIds,
        disliked_ids=req.dislikedIds,
        exclude_ids=req.excludeIds,
        alpha=req.alpha,
        beta=req.beta,
        languages=languages,
        min_rating=req.minRating,
        year_from=req.yearFrom,
        year_to=req.yearTo,
    )
    return {"results": results}
