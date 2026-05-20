from fastapi import APIRouter, Query

from .config import get_settings
from .index_store import get_store
from .tmdb import search_movies

router = APIRouter()


@router.get("/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(default=12, ge=1, le=20)):
    """Autocomplete for the seed picker.

    Strategy: use TMDB live so the user can find anything in TMDB's catalog
    (not just the local corpus). If TMDB isn't configured, fall back to a local
    LIKE search against the indexed movies.
    """
    if get_settings().tmdb_api_key:
        try:
            return {"results": search_movies(q, limit=limit), "source": "tmdb"}
        except Exception as e:
            # fall through to local search on TMDB failure
            print(f"tmdb search failed, falling back to local: {e}")
    return {"results": get_store().search_titles(q, limit=limit), "source": "local"}
