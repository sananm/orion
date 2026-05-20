from fastapi import APIRouter, HTTPException

from .index_store import get_store

router = APIRouter()


@router.get("/movie/{movie_id}")
def movie(movie_id: int):
    m = get_store().movie(movie_id)
    if not m:
        raise HTTPException(status_code=404, detail="movie not found")
    return m
