from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .index_store import get_store

router = APIRouter()


class SeedRequest(BaseModel):
    movieId: int


@router.post("/seed")
def seed(req: SeedRequest):
    """Ensure a movie exists in our local index. Idempotent.

    Used when the seed picker selects a movie that TMDB knew about but our
    pre-built corpus did not. The backend fetches the full TMDB record, embeds
    it locally, appends it to FAISS, and persists.
    """
    movie = get_store().ensure_movie(req.movieId)
    if not movie:
        raise HTTPException(status_code=404, detail="could not enrich movie from TMDB")
    return movie
