from fastapi import APIRouter

from .index_store import get_store

router = APIRouter()


@router.post("/admin/reload")
def reload_index():
    """Hot-reload the FAISS index + SQLite from disk. Use after running
    scripts/build_index.py so you don't have to restart uvicorn."""
    store = get_store()
    store.reload()
    return {
        "ok": True,
        "index_ready": store.ready,
        "tone_index_ready": store.tone_ready,
        "ntotal": store.size,
        "embedding_model": store.embedding_model,
        "index_embedding_model": store.index_embedding_model,
        "index_model_mismatch": store.index_model_mismatch,
    }


@router.post("/admin/reddit/enrich/{movie_id}")
def enrich_reddit_movie(movie_id: int, force: bool = False):
    store = get_store()
    movie = store.enrich_reddit_profile(movie_id, force=force)
    return {
        "ok": bool(movie),
        "movie": movie,
        "reddit_summary": movie.get("reddit_summary") if movie else None,
    }


@router.post("/admin/reddit/enrich")
def enrich_reddit_batch(limit: int = 50, force: bool = False):
    store = get_store()
    result = store.enrich_reddit_batch(limit=limit, force=force)
    return result
