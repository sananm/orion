from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .index_store import get_store
from .admin import router as admin_router
from .auth import router as auth_router
from .movie import router as movie_router
from .reddit import reddit_enabled
from .search import router as search_router
from .seed import router as seed_router
from .similar import router as similar_router

settings = get_settings()

app = FastAPI(title="Movie Constellation API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    store = get_store()
    return {
        "ok": True,
        "index_ready": store.ready,
        "tone_index_ready": store.tone_ready,
        "ntotal": store.size,
        "embedding_model": store.embedding_model,
        "index_embedding_model": store.index_embedding_model,
        "index_model_mismatch": store.index_model_mismatch,
        "reddit_enabled": reddit_enabled(),
        "data_dir": str(settings.data_dir),
    }


app.include_router(search_router, prefix="/api")
app.include_router(movie_router, prefix="/api")
app.include_router(similar_router, prefix="/api")
app.include_router(seed_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
