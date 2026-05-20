import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

from .embeddings import DEFAULT_EMBEDDING_MODEL, get_embedding_spec

API_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(API_DIR / ".env")


class Settings:
    db_path: Path
    faiss_path: Path
    tone_faiss_path: Path
    faiss_meta_path: Path
    embedding_dim: int

    def __init__(self):
        self.tmdb_api_key = os.environ.get("TMDB_API_KEY", "")
        self.data_dir = self._resolve_data_dir()
        self.allowed_origins = [
            o.strip()
            for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
            if o.strip()
        ]
        self.embedding_model = os.environ.get("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
        self.reddit_client_id = os.environ.get("REDDIT_CLIENT_ID", "")
        self.reddit_client_secret = os.environ.get("REDDIT_CLIENT_SECRET", "")
        self.reddit_user_agent = os.environ.get("REDDIT_USER_AGENT", "movie-constellation/0.1")
        self.reddit_subreddits = [
            part.strip()
            for part in os.environ.get("REDDIT_SUBREDDITS", "movies,TrueFilm,flicks,moviesuggestions").split(",")
            if part.strip()
        ]
        self.reddit_post_limit = int(os.environ.get("REDDIT_POST_LIMIT", "4"))
        self.reddit_comment_limit = int(os.environ.get("REDDIT_COMMENT_LIMIT", "20"))
        self.reddit_cache_ttl_hours = int(os.environ.get("REDDIT_CACHE_TTL_HOURS", "168"))
        self.tmdb_base = "https://api.themoviedb.org/3"
        self.tmdb_image_base = "https://image.tmdb.org/t/p/w500"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "movies.db"
        self.faiss_path = self.data_dir / "movies.faiss"
        self.tone_faiss_path = self.data_dir / "movies.tone.faiss"
        self.faiss_meta_path = self.data_dir / "movies.faiss.meta.json"
        self.embedding_dim = get_embedding_spec(self.embedding_model).dimension

    @staticmethod
    def _resolve_data_dir() -> Path:
        raw = os.environ.get("DATA_DIR")
        if not raw:
            return (REPO_ROOT / "data").resolve()
        data_dir = Path(raw)
        if data_dir.is_absolute():
            return data_dir.resolve()
        return (API_DIR / data_dir).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
