"""Tiny TMDB client used at request time for live search + on-demand enrichment.

Separate from scripts/fetch_tmdb.py which does the bulk corpus pull. This module
is sync and uses a module-level httpx.Client.
"""
from __future__ import annotations

from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import get_settings
from .text_profiles import build_embedding_text, build_text_profile

_client: httpx.Client | None = None


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=15)
    return _client


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=0.5, max=4))
def _get(path: str, **params: Any) -> dict:
    s = get_settings()
    if not s.tmdb_api_key:
        raise RuntimeError("TMDB_API_KEY not set")
    params["api_key"] = s.tmdb_api_key
    r = _http().get(f"{s.tmdb_base}{path}", params=params)
    r.raise_for_status()
    return r.json()


def _summary_to_movie(t: dict) -> dict:
    """Map a TMDB search/discover result (light) to our public movie shape."""
    s = get_settings()
    release = t.get("release_date") or ""
    year = int(release[:4]) if release[:4].isdigit() else None
    poster_path = t.get("poster_path")
    return {
        "id": t["id"],
        "title": t.get("title") or t.get("original_title"),
        "year": year,
        "language": t.get("original_language"),
        "imdb_id": None,
        "overview": t.get("overview"),
        "genres": [],          # filled by full fetch
        "cast": [],
        "director": None,
        "keywords": [],
        "tone_tags": [],
        "poster_url": (s.tmdb_image_base + poster_path) if poster_path else None,
        "imdb_rating": None,
        "imdb_vote_count": None,
        "vote_average": t.get("vote_average"),
        "vote_count": t.get("vote_count"),
        "popularity": t.get("popularity"),
    }


def search_movies(q: str, limit: int = 8) -> list[dict]:
    if not q.strip():
        return []
    data = _get(
        "/search/movie",
        query=q,
        include_adult="false",
        language="en-US",
        page=1,
    )
    results = data.get("results", []) or []
    # TMDB returns up to 20 per page; trim and prefer ones with posters
    results.sort(key=lambda t: (t.get("poster_path") is None, -(t.get("popularity") or 0)))
    return [_summary_to_movie(t) for t in results[:limit]]


def fetch_full(movie_id: int) -> dict | None:
    """Fetch a movie's full record (genres, cast, director, keywords) from TMDB.

    Returns the *DB row* shape (genres/cast/keywords as Python lists, not JSON
    strings — the caller serializes when inserting).
    """
    try:
        data = _get(f"/movie/{movie_id}", append_to_response="credits,keywords,external_ids")
    except Exception:
        return None
    crew = (data.get("credits") or {}).get("crew", []) or []
    director = next((c["name"] for c in crew if c.get("job") == "Director"), None)
    cast = [c["name"] for c in (data.get("credits") or {}).get("cast", [])[:10]]
    keywords = [k["name"] for k in (data.get("keywords") or {}).get("keywords", [])]
    genres = [g["name"] for g in data.get("genres", []) or []]
    release = data.get("release_date") or ""
    year = int(release[:4]) if release[:4].isdigit() else None
    movie = {
        "id": data["id"],
        "title": data.get("title"),
        "year": year,
        "language": data.get("original_language"),
        "imdb_id": ((data.get("external_ids") or {}).get("imdb_id")),
        "overview": data.get("overview"),
        "genres": genres,
        "cast": cast,
        "director": director,
        "keywords": keywords,
        "poster_path": data.get("poster_path"),
        "imdb_rating": None,
        "imdb_vote_count": None,
        "vote_average": data.get("vote_average"),
        "vote_count": data.get("vote_count"),
        "popularity": data.get("popularity"),
    }
    profile = build_text_profile(movie)
    movie["tone_tags"] = profile["tone_tags"]
    movie["tone_text"] = profile["tone_text"]
    return movie


__all__ = ["search_movies", "fetch_full", "build_embedding_text"]
