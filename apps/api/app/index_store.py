"""Loads the FAISS index and SQLite metadata, exposes lookup + kNN.

Also supports on-demand enrichment: `ensure_movie(id)` will fetch a missing
movie from TMDB, embed it locally, append it to FAISS, and persist — so the
seed picker can use the full TMDB catalog even if our pre-built corpus is small.

Designed to fail soft: if neither asset exists, lookups return empty so the
API still boots.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import sqlite3
import threading
from typing import Iterable

import numpy as np

from .config import get_settings
from .embeddings import get_embedding_spec
from .text_profiles import (
    BROAD_GENRES,
    STRUCTURAL_STORY_CUES,
    extract_story_cues,
    extract_tone_tags,
)


# Schema mirrors scripts/fetch_tmdb.py
_INIT_SQL = """
CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY,
    title TEXT,
    year INTEGER,
    language TEXT,
    imdb_id TEXT,
    overview TEXT,
    genres TEXT,
    cast TEXT,
    director TEXT,
    keywords TEXT,
    poster_path TEXT,
    imdb_rating REAL,
    imdb_vote_count INTEGER,
    vote_average REAL,
    vote_count INTEGER,
    popularity REAL,
    embedding_text TEXT,
    reddit_tone_tags TEXT,
    reddit_cues TEXT,
    reddit_summary TEXT,
    reddit_post_count INTEGER,
    reddit_comment_count INTEGER,
    reddit_cached_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity DESC);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE TABLE IF NOT EXISTS imdb_ratings_cache (
    imdb_id TEXT PRIMARY KEY,
    imdb_rating REAL,
    imdb_vote_count INTEGER
);
"""


def _normalized_terms(values: Iterable[str]) -> set[str]:
    return {value.strip().lower() for value in values if value and value.strip()}


def _content_bonus(seed_movie: dict | None, candidate_movie: dict) -> float:
    if not seed_movie:
        return 0.0

    structural_weights = {
        "memory collapse": 0.18,
        "unreliable reality": 0.16,
        "identity fracture": 0.08,
        "nonlinear structure": 0.14,
        "caregiver pressure": 0.06,
        "grief spiral": 0.06,
        "investigation spiral": 0.08,
    }

    bonus = 0.0
    seed_story_cues = _normalized_terms(seed_movie.get("story_cues", []))
    candidate_story_cues = _normalized_terms(candidate_movie.get("story_cues", []))
    raw_seed_genres = _normalized_terms(seed_movie.get("genres", []))
    raw_candidate_genres = _normalized_terms(candidate_movie.get("genres", []))

    seed_genres = raw_seed_genres - BROAD_GENRES
    candidate_genres = raw_candidate_genres - BROAD_GENRES
    if seed_genres and candidate_genres:
        shared_genres = seed_genres & candidate_genres
        if shared_genres:
            overlap = len(shared_genres) / max(len(seed_genres), len(candidate_genres))
            bonus += 0.10 + 0.14 * overlap
        else:
            bonus -= 0.08

    seed_keywords = _normalized_terms(seed_movie.get("keywords", []))
    candidate_keywords = _normalized_terms(candidate_movie.get("keywords", []))
    if seed_keywords and candidate_keywords:
        shared_keywords = seed_keywords & candidate_keywords
        weighted = 0.0
        for keyword in shared_keywords:
            weighted += 0.05 if " " in keyword else 0.025
        bonus += min(0.28, weighted)

    if seed_story_cues and candidate_story_cues:
        shared_story_cues = seed_story_cues & candidate_story_cues
        bonus += min(0.42, sum(structural_weights.get(cue, 0.06) for cue in shared_story_cues))

    seed_structural = seed_story_cues & STRUCTURAL_STORY_CUES
    candidate_structural = candidate_story_cues & STRUCTURAL_STORY_CUES
    if seed_structural:
        if candidate_structural:
            bonus += min(0.28, sum(structural_weights.get(cue, 0.08) * 0.6 for cue in (seed_structural & candidate_structural)))
        else:
            bonus -= 0.22
            if raw_candidate_genres == {"drama"}:
                bonus -= 0.12
        if "comedy" in raw_candidate_genres and "comedy" not in raw_seed_genres:
            if "memory collapse" not in candidate_structural and "thriller" not in raw_candidate_genres and "mystery" not in raw_candidate_genres:
                bonus -= 0.24
        if "unreliable reality" in seed_structural and "unreliable reality" not in candidate_structural:
            bonus -= 0.10
        if "memory collapse" in seed_structural and "memory collapse" not in candidate_structural:
            bonus -= 0.14
        if "identity fracture" in candidate_structural and "memory collapse" not in candidate_structural and "thriller" not in raw_candidate_genres:
            bonus -= 0.10

    if seed_keywords and not candidate_keywords and seed_story_cues:
        bonus -= 0.06
    return bonus


def _load_index_meta() -> dict | None:
    settings = get_settings()
    if not settings.faiss_meta_path.exists():
        return None
    try:
        return json.loads(settings.faiss_meta_path.read_text())
    except json.JSONDecodeError:
        return None


def _parse_cached_at(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


class IndexStore:
    def __init__(self) -> None:
        self._loaded = False
        self._index = None  # faiss.Index
        self._tone_index = None  # faiss.Index
        self._id_to_row: dict[int, int] = {}
        self._row_to_id: list[int] = []
        self._conn: sqlite3.Connection | None = None
        self._vectors: np.ndarray | None = None
        self._tone_vectors: np.ndarray | None = None
        self._model = None  # lazy SentenceTransformer
        self._index_meta: dict | None = None
        self._index_model_mismatch: str | None = None
        self._write_lock = threading.Lock()

    # ---------- load / lifecycle ----------

    def load(self) -> None:
        settings = get_settings()
        # Always open the DB (create if missing) so we can enrich on demand.
        self._conn = sqlite3.connect(str(settings.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_INIT_SQL)
        self._ensure_schema()
        self._conn.commit()

        if not settings.faiss_path.exists():
            # No prebuilt index. We'll lazily create one if/when ensure_movie runs.
            return

        import faiss

        self._index = faiss.read_index(str(settings.faiss_path))
        if settings.tone_faiss_path.exists():
            self._tone_index = faiss.read_index(str(settings.tone_faiss_path))
        else:
            self._tone_index = None
        self._index_meta = _load_index_meta()

        map_path = settings.faiss_path.with_name(settings.faiss_path.name + ".ids.json")
        if not map_path.exists():
            raise RuntimeError(f"Missing FAISS id map at {map_path}")
        self._row_to_id = json.loads(map_path.read_text())
        self._id_to_row = {mid: i for i, mid in enumerate(self._row_to_id)}

        self._vectors = self._index.reconstruct_n(0, self._index.ntotal).astype(np.float32)
        if self._tone_index is not None and self._tone_index.ntotal == self._index.ntotal:
            self._tone_vectors = self._tone_index.reconstruct_n(0, self._tone_index.ntotal).astype(np.float32)
        else:
            self._tone_vectors = None
        self._check_embedding_compatibility()
        self._loaded = True

    def reload(self) -> None:
        """Re-read the FAISS index + ids map from disk. Keeps the embedding
        model cached so subsequent on-demand seeds stay fast."""
        with self._write_lock:
            self._index = None
            self._tone_index = None
            self._vectors = None
            self._tone_vectors = None
            self._row_to_id = []
            self._id_to_row = {}
            self._index_meta = None
            self._index_model_mismatch = None
            self._loaded = False
            self.load()

    @property
    def ready(self) -> bool:
        return self._loaded

    @property
    def size(self) -> int:
        return self._index.ntotal if self._index is not None else 0

    @property
    def tone_ready(self) -> bool:
        return self._tone_vectors is not None

    @property
    def embedding_model(self) -> str:
        return get_settings().embedding_model

    @property
    def index_embedding_model(self) -> str | None:
        if self._index_meta:
            model_name = self._index_meta.get("embedding_model")
            return str(model_name) if model_name else None
        return None

    @property
    def index_model_mismatch(self) -> str | None:
        return self._index_model_mismatch

    # ---------- read paths ----------

    def movie(self, movie_id: int) -> dict | None:
        if not self._conn:
            return None
        row = self._conn.execute("SELECT * FROM movies WHERE id = ?", (movie_id,)).fetchone()
        return _row_to_movie(row) if row else None

    def movies(self, ids: Iterable[int]) -> list[dict]:
        if not self._conn:
            return []
        ids = list(ids)
        if not ids:
            return []
        placeholders = ",".join("?" for _ in ids)
        rows = self._conn.execute(
            f"SELECT * FROM movies WHERE id IN ({placeholders})", ids
        ).fetchall()
        by_id = {r["id"]: r for r in rows}
        return [_row_to_movie(by_id[i]) for i in ids if i in by_id]

    def search_titles(self, q: str, limit: int = 8) -> list[dict]:
        if not self._conn or not q.strip():
            return []
        like = f"%{q.strip().lower()}%"
        rows = self._conn.execute(
            """
            SELECT * FROM movies
            WHERE LOWER(title) LIKE ?
            ORDER BY popularity DESC
            LIMIT ?
            """,
            (like, limit),
        ).fetchall()
        return [_row_to_movie(r) for r in rows]

    def _reddit_profile_is_stale(self, movie: dict | None, force: bool = False) -> bool:
        if force:
            return True
        if not movie or not movie.get("reddit_summary"):
            return True
        cached_at = _parse_cached_at(movie.get("reddit_cached_at"))
        if cached_at is None:
            return True
        ttl = timedelta(hours=get_settings().reddit_cache_ttl_hours)
        return datetime.now(timezone.utc) - cached_at >= ttl

    def _update_reddit_profile(self, movie_id: int, profile: dict | None) -> None:
        assert self._conn is not None
        now = datetime.now(timezone.utc).isoformat()
        tone_tags = profile.get("reddit_tone_tags", []) if profile else []
        cues = profile.get("reddit_cues", []) if profile else []
        summary = profile.get("reddit_summary") if profile else None
        post_count = int(profile.get("reddit_post_count") or 0) if profile else 0
        comment_count = int(profile.get("reddit_comment_count") or 0) if profile else 0
        cached_at = profile.get("reddit_cached_at") if profile else now
        self._conn.execute(
            """
            UPDATE movies
            SET reddit_tone_tags = ?, reddit_cues = ?, reddit_summary = ?,
                reddit_post_count = ?, reddit_comment_count = ?, reddit_cached_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(tone_tags),
                json.dumps(cues),
                summary,
                post_count,
                comment_count,
                cached_at,
                movie_id,
            ),
        )
        self._conn.commit()

    def enrich_reddit_profile(self, movie_id: int, force: bool = False) -> dict | None:
        if not self._conn:
            return None
        movie = self.movie(movie_id)
        if not movie:
            return None

        from .reddit import fetch_reddit_profile, reddit_enabled

        if not reddit_enabled() or not self._reddit_profile_is_stale(movie, force=force):
            return movie

        profile = fetch_reddit_profile(movie)
        with self._write_lock:
            self._update_reddit_profile(movie_id, profile)
        return self.movie(movie_id)

    def enrich_reddit_batch(
        self,
        limit: int = 50,
        force: bool = False,
        movie_ids: list[int] | None = None,
    ) -> dict:
        if not self._conn:
            return {"ok": False, "reason": "db_not_ready", "enriched": 0, "requested": 0}

        from .reddit import reddit_enabled

        if not reddit_enabled():
            return {"ok": False, "reason": "reddit_not_configured", "enriched": 0, "requested": 0}

        ids = list(movie_ids or [])
        if not ids:
            if force:
                rows = self._conn.execute(
                    "SELECT id FROM movies ORDER BY popularity DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            else:
                threshold = (datetime.now(timezone.utc) - timedelta(hours=get_settings().reddit_cache_ttl_hours)).isoformat()
                rows = self._conn.execute(
                    """
                    SELECT id FROM movies
                    WHERE reddit_cached_at IS NULL OR reddit_summary IS NULL OR reddit_cached_at < ?
                    ORDER BY popularity DESC
                    LIMIT ?
                    """,
                    (threshold, limit),
                ).fetchall()
            ids = [int(row["id"]) for row in rows]

        enriched = 0
        for movie_id in ids:
            movie = self.enrich_reddit_profile(movie_id, force=force)
            if movie and movie.get("reddit_cached_at"):
                enriched += 1
        return {"ok": True, "enriched": enriched, "requested": len(ids)}

    def vector_for(self, movie_id: int) -> np.ndarray | None:
        if self._vectors is None:
            return None
        row = self._id_to_row.get(movie_id)
        if row is None:
            return None
        return self._vectors[row]

    def tone_vector_for(self, movie_id: int) -> np.ndarray | None:
        if self._tone_vectors is None:
            return self.vector_for(movie_id)
        row = self._id_to_row.get(movie_id)
        if row is None:
            return None
        return self._tone_vectors[row]

    def _candidate_rows(
        self,
        languages: set[str],
        min_rating: float | None,
        year_from: int | None,
        year_to: int | None,
    ) -> np.ndarray | None:
        if not self._conn or not (languages or min_rating is not None or year_from is not None or year_to is not None):
            return None

        clauses = ["1 = 1"]
        params: list[object] = []

        if languages:
            placeholders = ",".join("?" for _ in languages)
            clauses.append(f"LOWER(language) IN ({placeholders})")
            params.extend(sorted(languages))
        if min_rating is not None:
            clauses.append("imdb_rating >= ?")
            params.append(min_rating)
        if year_from is not None:
            clauses.append("year >= ?")
            params.append(year_from)
        if year_to is not None:
            clauses.append("year <= ?")
            params.append(year_to)

        rows = self._conn.execute(
            f"SELECT id FROM movies WHERE {' AND '.join(clauses)}",
            params,
        ).fetchall()
        candidate_rows = [self._id_to_row[int(row["id"])] for row in rows if int(row["id"]) in self._id_to_row]
        if not candidate_rows:
            return np.empty(0, dtype=np.int32)
        return np.array(candidate_rows, dtype=np.int32)

    def similar(
        self,
        movie_id: int,
        k: int = 5,
        liked_ids: list[int] | None = None,
        disliked_ids: list[int] | None = None,
        exclude_ids: list[int] | None = None,
        alpha: float = 0.3,
        beta: float = 0.5,
        languages: list[str] | None = None,
        min_rating: float | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
    ) -> list[dict]:
        if self._vectors is None:
            return []
        v = self.vector_for(movie_id)
        if v is None:
            return []
        parent_movie = self.movie(movie_id)
        parent_story_cues = _normalized_terms(parent_movie.get("story_cues", [])) if parent_movie else set()
        liked_ids = liked_ids or []
        disliked_ids = disliked_ids or []
        selected_languages = {language.strip().lower() for language in (languages or []) if language.strip()}
        exclude = set(exclude_ids or []) | {movie_id} | set(disliked_ids)

        def centroid(ids: list[int], vectors: np.ndarray | None) -> np.ndarray | None:
            if vectors is None:
                return None
            rows = [self._id_to_row[i] for i in ids if i in self._id_to_row]
            if not rows:
                return None
            c = vectors[rows].mean(axis=0)
            n = np.linalg.norm(c)
            return c / n if n > 0 else None

        v_like = centroid(liked_ids, self._vectors)
        v_dislike = centroid(disliked_ids, self._vectors)

        content_scores = self._vectors @ v.astype(np.float32)
        if v_like is not None:
            content_scores = content_scores + alpha * (self._vectors @ v_like.astype(np.float32))
        if v_dislike is not None:
            content_scores = content_scores - beta * (self._vectors @ v_dislike.astype(np.float32))
        scores = content_scores

        candidate_rows = self._candidate_rows(selected_languages, min_rating, year_from, year_to)
        if candidate_rows is not None and candidate_rows.size == 0:
            return []

        structural_seed = bool(parent_story_cues & STRUCTURAL_STORY_CUES)
        candidate_budget = 420 if structural_seed else 350 if selected_languages or min_rating is not None or year_from is not None or year_to is not None else 220
        if candidate_rows is None:
            score_pool = scores
            row_pool = np.arange(len(scores), dtype=np.int32)
        else:
            row_pool = candidate_rows
            score_pool = scores[row_pool]

        n_candidates = min(max(k * 25, len(exclude) + candidate_budget), len(score_pool))
        top_pool_rows = np.argpartition(-score_pool, n_candidates - 1)[:n_candidates]
        top_pool_rows = top_pool_rows[np.argsort(-score_pool[top_pool_rows])]
        top_rows = row_pool[top_pool_rows]

        results: list[dict] = []
        for row in top_rows:
            mid = self._row_to_id[int(row)]
            if mid in exclude:
                continue
            movie = self.movie(mid)
            if not movie:
                continue
            if selected_languages and (movie.get("language") or "").lower() not in selected_languages:
                continue
            rating = movie.get("imdb_rating")
            if min_rating is not None and (rating is None or rating < min_rating):
                continue
            movie_year = movie.get("year")
            if year_from is not None and (movie_year is None or movie_year < year_from):
                continue
            if year_to is not None and (movie_year is None or movie_year > year_to):
                continue
            movie["score"] = float(scores[int(row)] + _content_bonus(parent_movie, movie))
            results.append(movie)
        results.sort(key=lambda movie: movie["score"], reverse=True)
        return results[:k]

    # ---------- on-demand enrichment ----------

    def _check_embedding_compatibility(self) -> None:
        settings = get_settings()
        if self._index is None:
            self._index_model_mismatch = None
            return
        index_dim = int(self._index.d)
        meta_model = self.index_embedding_model
        if meta_model and meta_model != settings.embedding_model:
            self._index_model_mismatch = (
                f"index built with {meta_model}, but EMBEDDING_MODEL is {settings.embedding_model}. "
                "Rebuild the index before adding new movies."
            )
            return
        expected_dim = get_embedding_spec(settings.embedding_model).dimension
        if expected_dim and index_dim != expected_dim:
            self._index_model_mismatch = (
                f"index dimension {index_dim} does not match EMBEDDING_MODEL {settings.embedding_model} "
                f"({expected_dim}). Rebuild the index before adding new movies."
            )
            return
        self._index_model_mismatch = None

    def _assert_index_is_mutable(self) -> None:
        if self._index_model_mismatch:
            raise RuntimeError(self._index_model_mismatch)

    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            settings = get_settings()
            print(f"loading embedding model {settings.embedding_model}…")
            self._model = SentenceTransformer(settings.embedding_model)
        return self._model

    def _embed(self, text: str) -> np.ndarray:
        model = self._get_model()
        spec = get_embedding_spec(get_settings().embedding_model)
        v = model.encode(
            [spec.prepare_corpus_text(text)],
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        return v.astype(np.float32)  # shape (1, dim)

    def ensure_movie(self, movie_id: int) -> dict | None:
        """If already in the index, return its public record. Otherwise fetch
        from TMDB, embed, persist."""
        if not self._conn:
            return None
        existing = self.movie(movie_id)
        if existing and movie_id in self._id_to_row:
            return existing

        from .tmdb import fetch_full, build_embedding_text

        with self._write_lock:
            self._assert_index_is_mutable()
            # re-check under lock
            if movie_id in self._id_to_row and self.movie(movie_id):
                return self.movie(movie_id)

            full = fetch_full(movie_id)
            if not full:
                return None
            self._hydrate_imdb_rating(full)
            embedding_text = build_embedding_text(full)
            vec = self._embed(embedding_text)  # (1, dim)

            tone_text = full.get("tone_text") or embedding_text
            tone_vec = self._embed(tone_text)

            self._upsert_db(full, embedding_text)
            self._extend_index(movie_id, vec[0], tone_vec[0])
            self._persist()
        return self.movie(movie_id)

    def _ensure_schema(self) -> None:
        assert self._conn is not None
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS imdb_ratings_cache (
                imdb_id TEXT PRIMARY KEY,
                imdb_rating REAL,
                imdb_vote_count INTEGER
            )
            """
        )
        columns = {
            row["name"]
            for row in self._conn.execute("PRAGMA table_info(movies)").fetchall()
        }
        if "language" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN language TEXT")
        if "imdb_id" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN imdb_id TEXT")
        if "tone_tags" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN tone_tags TEXT")
        if "tone_text" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN tone_text TEXT")
        if "imdb_rating" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN imdb_rating REAL")
        if "imdb_vote_count" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN imdb_vote_count INTEGER")
        if "reddit_tone_tags" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN reddit_tone_tags TEXT")
        if "reddit_cues" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN reddit_cues TEXT")
        if "reddit_summary" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN reddit_summary TEXT")
        if "reddit_post_count" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN reddit_post_count INTEGER")
        if "reddit_comment_count" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN reddit_comment_count INTEGER")
        if "reddit_cached_at" not in columns:
            self._conn.execute("ALTER TABLE movies ADD COLUMN reddit_cached_at TEXT")

    def _hydrate_imdb_rating(self, movie: dict) -> None:
        assert self._conn is not None
        imdb_id = movie.get("imdb_id")
        if not imdb_id:
            return
        row = self._conn.execute(
            "SELECT imdb_rating, imdb_vote_count FROM imdb_ratings_cache WHERE imdb_id = ?",
            (imdb_id,),
        ).fetchone()
        if not row:
            return
        movie["imdb_rating"] = row["imdb_rating"]
        movie["imdb_vote_count"] = row["imdb_vote_count"]

    def _upsert_db(self, m: dict, embedding_text: str) -> None:
        assert self._conn is not None
        self._conn.execute(
            """
            INSERT INTO movies (id, title, year, language, imdb_id, overview, genres, cast, director, keywords,
                                tone_tags, tone_text, poster_path, imdb_rating, imdb_vote_count, vote_average, vote_count, popularity, embedding_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title, year=excluded.year, language=excluded.language, imdb_id=excluded.imdb_id, overview=excluded.overview,
                genres=excluded.genres, cast=excluded.cast, director=excluded.director,
                keywords=excluded.keywords, tone_tags=excluded.tone_tags, tone_text=excluded.tone_text,
                poster_path=excluded.poster_path,
                imdb_rating=COALESCE(excluded.imdb_rating, movies.imdb_rating),
                imdb_vote_count=COALESCE(excluded.imdb_vote_count, movies.imdb_vote_count),
                vote_average=excluded.vote_average, vote_count=excluded.vote_count,
                popularity=excluded.popularity, embedding_text=excluded.embedding_text
            """,
            (
                m["id"], m["title"], m["year"], m.get("language"), m.get("imdb_id"), m["overview"],
                json.dumps(m["genres"]), json.dumps(m["cast"]), m["director"], json.dumps(m["keywords"]),
                json.dumps(m.get("tone_tags", [])), m.get("tone_text") or embedding_text,
                m["poster_path"], m.get("imdb_rating"), m.get("imdb_vote_count"), m["vote_average"], m["vote_count"], m["popularity"],
                embedding_text,
            ),
        )
        self._conn.commit()

    def _extend_index(self, movie_id: int, vector: np.ndarray, tone_vector: np.ndarray) -> None:
        """Append a single content + tone vector to the FAISS indices."""
        import faiss

        dim = vector.shape[-1]
        if self._index is None:
            self._index = faiss.IndexFlatIP(dim)
            self._vectors = np.zeros((0, dim), dtype=np.float32)
            self._row_to_id = []
            self._id_to_row = {}
        if self._tone_index is None:
            self._tone_index = faiss.IndexFlatIP(dim)
            self._tone_vectors = np.zeros((0, dim), dtype=np.float32)
        v = vector.reshape(1, -1).astype(np.float32)
        tone_v = tone_vector.reshape(1, -1).astype(np.float32)
        self._index.add(v)
        self._tone_index.add(tone_v)
        self._vectors = np.concatenate([self._vectors, v], axis=0) if self._vectors is not None else v
        self._tone_vectors = (
            np.concatenate([self._tone_vectors, tone_v], axis=0)
            if self._tone_vectors is not None
            else tone_v
        )
        self._row_to_id.append(movie_id)
        self._id_to_row[movie_id] = len(self._row_to_id) - 1
        self._loaded = True
        self._index_meta = {
            "embedding_model": get_settings().embedding_model,
            "embedding_dim": dim,
            "corpus_prefix": get_embedding_spec(get_settings().embedding_model).corpus_prefix,
            "query_prefix": get_embedding_spec(get_settings().embedding_model).query_prefix,
            "count": len(self._row_to_id),
        }
        self._check_embedding_compatibility()

    def _write_index_meta(self) -> None:
        settings = get_settings()
        spec = get_embedding_spec(settings.embedding_model)
        dim = int(self._index.d) if self._index is not None else spec.dimension
        count = len(self._row_to_id)
        self._index_meta = {
            "embedding_model": settings.embedding_model,
            "embedding_dim": dim,
            "corpus_prefix": spec.corpus_prefix,
            "query_prefix": spec.query_prefix,
            "count": count,
        }
        settings.faiss_meta_path.write_text(json.dumps(self._index_meta, indent=2))

    def _persist(self) -> None:
        import faiss
        settings = get_settings()
        faiss.write_index(self._index, str(settings.faiss_path))
        if self._tone_index is not None:
            faiss.write_index(self._tone_index, str(settings.tone_faiss_path))
        map_path = settings.faiss_path.with_name(settings.faiss_path.name + ".ids.json")
        map_path.write_text(json.dumps(self._row_to_id))
        self._write_index_meta()


def _row_to_movie(row: sqlite3.Row) -> dict:
    s = get_settings()
    poster_path = row["poster_path"]
    movie = {
        "id": row["id"],
        "title": row["title"],
        "year": row["year"],
        "language": row["language"] if "language" in row.keys() else None,
        "imdb_id": row["imdb_id"] if "imdb_id" in row.keys() else None,
        "overview": row["overview"],
        "genres": json.loads(row["genres"]) if row["genres"] else [],
        "cast": json.loads(row["cast"]) if row["cast"] else [],
        "director": row["director"],
        "keywords": json.loads(row["keywords"]) if row["keywords"] else [],
        "tone_tags": json.loads(row["tone_tags"]) if "tone_tags" in row.keys() and row["tone_tags"] else [],
        "poster_url": (s.tmdb_image_base + poster_path) if poster_path else None,
        "imdb_rating": row["imdb_rating"] if "imdb_rating" in row.keys() else None,
        "imdb_vote_count": row["imdb_vote_count"] if "imdb_vote_count" in row.keys() else None,
        "vote_average": row["vote_average"],
        "vote_count": row["vote_count"],
        "popularity": row["popularity"],
        "reddit_tone_tags": (
            json.loads(row["reddit_tone_tags"])
            if "reddit_tone_tags" in row.keys() and row["reddit_tone_tags"]
            else []
        ),
        "reddit_cues": (
            json.loads(row["reddit_cues"])
            if "reddit_cues" in row.keys() and row["reddit_cues"]
            else []
        ),
        "reddit_summary": row["reddit_summary"] if "reddit_summary" in row.keys() else None,
        "reddit_post_count": row["reddit_post_count"] if "reddit_post_count" in row.keys() else 0,
        "reddit_comment_count": row["reddit_comment_count"] if "reddit_comment_count" in row.keys() else 0,
        "reddit_cached_at": row["reddit_cached_at"] if "reddit_cached_at" in row.keys() else None,
    }
    movie["tone_tags"] = extract_tone_tags(movie)
    movie["story_cues"] = extract_story_cues(movie)
    return movie


_store: IndexStore | None = None


def get_store() -> IndexStore:
    global _store
    if _store is None:
        _store = IndexStore()
        _store.load()
    return _store
