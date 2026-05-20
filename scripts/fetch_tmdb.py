"""Pull a large local movie corpus from TMDB into data/movies.db.

The collector mixes a few discovery streams so the local corpus is less biased
toward only the current globally popular titles:
- global popularity
- top rated
- yearly popularity slices across decades

Concurrency model: a single thread paginates summary streams; a
ThreadPoolExecutor fetches per-movie details in parallel. Resumable: movies
already in the DB are skipped unless --refresh is passed.

Usage:
    python scripts/fetch_tmdb.py --limit 200          # quick dev
    python scripts/fetch_tmdb.py --limit 0            # exhaust configured streams
    python scripts/fetch_tmdb.py --limit 50000 -w 30  # broad corpus, 30 workers
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from threading import Lock

import httpx
from dotenv import load_dotenv
from tenacity import RetryError, retry, stop_after_attempt, wait_exponential
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "apps" / "api" / ".env")
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.text_profiles import build_text_profile

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
if not TMDB_API_KEY:
    sys.exit("TMDB_API_KEY not set (see apps/api/.env.example)")

BASE = "https://api.themoviedb.org/3"
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "movies.db"


@dataclass(frozen=True)
class SummaryStream:
    name: str
    path: str
    params: dict[str, str | int]
    page_limit: int | None = None


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
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
            tone_tags TEXT,
            tone_text TEXT,
            reddit_tone_tags TEXT,
            reddit_cues TEXT,
            reddit_summary TEXT,
            reddit_post_count INTEGER,
            reddit_comment_count INTEGER,
            reddit_cached_at TEXT,
            poster_path TEXT,
            imdb_rating REAL,
            imdb_vote_count INTEGER,
            vote_average REAL,
            vote_count INTEGER,
            popularity REAL,
            embedding_text TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_movies_popularity ON movies(popularity DESC);
        CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
    """)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(movies)").fetchall()}
    if "language" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN language TEXT")
    if "imdb_id" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN imdb_id TEXT")
    if "tone_tags" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN tone_tags TEXT")
    if "tone_text" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN tone_text TEXT")
    if "reddit_tone_tags" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN reddit_tone_tags TEXT")
    if "reddit_cues" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN reddit_cues TEXT")
    if "reddit_summary" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN reddit_summary TEXT")
    if "reddit_post_count" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN reddit_post_count INTEGER")
    if "reddit_comment_count" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN reddit_comment_count INTEGER")
    if "reddit_cached_at" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN reddit_cached_at TEXT")
    if "imdb_rating" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN imdb_rating REAL")
    if "imdb_vote_count" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN imdb_vote_count INTEGER")
    conn.commit()


@retry(stop=stop_after_attempt(5), wait=wait_exponential(min=1, max=20))
def tmdb_get(client: httpx.Client, path: str, **params) -> dict:
    params["api_key"] = TMDB_API_KEY
    r = client.get(f"{BASE}{path}", params=params, timeout=20)
    if r.status_code == 429:
        # Honor Retry-After if present
        wait = float(r.headers.get("Retry-After", "2"))
        time.sleep(wait)
        r.raise_for_status()
    r.raise_for_status()
    return r.json()


def summary_page(client: httpx.Client, stream: SummaryStream, page: int) -> list[dict]:
    data = tmdb_get(client, stream.path, page=page, **stream.params)
    return data.get("results", [])


def fetch_details(client: httpx.Client, movie_id: int) -> dict | None:
    try:
        return tmdb_get(client, f"/movie/{movie_id}", append_to_response="credits,keywords,external_ids")
    except Exception:
        return None


def normalize(details: dict, summary: dict) -> dict:
    crew = (details.get("credits") or {}).get("crew", []) or []
    director = next((c["name"] for c in crew if c.get("job") == "Director"), None)
    cast = [c["name"] for c in (details.get("credits") or {}).get("cast", [])[:10]]
    keywords = [k["name"] for k in (details.get("keywords") or {}).get("keywords", [])]
    genres = [g["name"] for g in details.get("genres", []) or []]
    release = details.get("release_date") or summary.get("release_date") or ""
    year = int(release[:4]) if release[:4].isdigit() else None
    record = {
        "id": details["id"],
        "title": details.get("title") or summary.get("title"),
        "year": year,
        "language": details.get("original_language") or summary.get("original_language"),
        "imdb_id": ((details.get("external_ids") or {}).get("imdb_id")),
        "overview": details.get("overview") or summary.get("overview"),
        "genres": genres,
        "cast": cast,
        "director": director,
        "keywords": keywords,
        "poster_path": details.get("poster_path") or summary.get("poster_path"),
        "imdb_rating": None,
        "imdb_vote_count": None,
        "vote_average": details.get("vote_average"),
        "vote_count": details.get("vote_count"),
        "popularity": details.get("popularity") or summary.get("popularity"),
    }
    profile = build_text_profile(record)
    record["embedding_text"] = profile["embedding_text"]
    record["tone_tags"] = profile["tone_tags"]
    record["tone_text"] = profile["tone_text"]
    return record


def upsert(conn: sqlite3.Connection, m: dict) -> None:
    conn.execute(
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
            m["id"], m["title"], m["year"], m["language"], m.get("imdb_id"), m["overview"],
            json.dumps(m["genres"]), json.dumps(m["cast"]), m["director"], json.dumps(m["keywords"]),
            json.dumps(m["tone_tags"]), m["tone_text"],
            m["poster_path"], m.get("imdb_rating"), m.get("imdb_vote_count"), m["vote_average"], m["vote_count"], m["popularity"],
            m["embedding_text"],
        ),
    )


def existing_ids(conn: sqlite3.Connection) -> set[int]:
    return {row[0] for row in conn.execute("SELECT id FROM movies").fetchall()}


def build_streams(args: argparse.Namespace) -> list[SummaryStream]:
    current_year = args.year_end or date.today().year
    streams: list[SummaryStream] = []

    for language_code in args.language_stream:
        streams.append(
            SummaryStream(
                name=f"lang-{language_code}-popular",
                path="/discover/movie",
                params={
                    "sort_by": "popularity.desc",
                    "include_adult": "false",
                    "include_video": "false",
                    "language": "en-US",
                    "with_original_language": language_code,
                },
                page_limit=args.language_pages,
            )
        )

        for year in range(current_year, args.language_year_start - 1, -1):
            streams.append(
                SummaryStream(
                    name=f"lang-{language_code}-year-{year}",
                    path="/discover/movie",
                    params={
                        "sort_by": "popularity.desc",
                        "include_adult": "false",
                        "include_video": "false",
                        "language": "en-US",
                        "with_original_language": language_code,
                        "primary_release_year": year,
                    },
                    page_limit=args.language_year_pages,
                )
            )

    streams.extend([
        SummaryStream(
            name="global-popular",
            path="/discover/movie",
            params={
                "sort_by": "popularity.desc",
                "include_adult": "false",
                "include_video": "false",
                "language": "en-US",
            },
            page_limit=500,
        ),
        SummaryStream(
            name="top-rated",
            path="/movie/top_rated",
            params={"language": "en-US"},
            page_limit=args.top_rated_pages,
        ),
    ])

    for year in range(current_year, args.year_start - 1, -1):
        streams.append(
            SummaryStream(
                name=f"year-{year}",
                path="/discover/movie",
                params={
                    "sort_by": "popularity.desc",
                    "include_adult": "false",
                    "include_video": "false",
                    "language": "en-US",
                    "primary_release_year": year,
                },
                page_limit=args.year_pages,
            )
        )
    return streams


def is_terminal_page_error(exc: Exception) -> bool:
    cause: Exception = exc
    if isinstance(exc, RetryError):
        try:
            cause = exc.last_attempt.exception() or exc
        except Exception:
            cause = exc
    if not isinstance(cause, httpx.HTTPStatusError):
        return False
    return cause.response.status_code in {400, 404, 422}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--limit",
        type=int,
        default=50000,
        help="how many movies total to have in the DB; use 0 to exhaust all configured streams",
    )
    ap.add_argument("-w", "--workers", type=int, default=20, help="parallel detail fetches")
    ap.add_argument("--refresh", action="store_true", help="re-fetch even if already in DB")
    ap.add_argument("--year-start", type=int, default=1950)
    ap.add_argument("--year-end", type=int, default=0, help="defaults to the current year")
    ap.add_argument("--year-pages", type=int, default=3, help="pages to fetch per release year slice")
    ap.add_argument("--top-rated-pages", type=int, default=120)
    ap.add_argument(
        "--language-stream",
        action="append",
        default=[],
        help="original language code to prioritize, e.g. --language-stream hi",
    )
    ap.add_argument("--language-pages", type=int, default=120, help="pages to fetch for each prioritized language popularity stream")
    ap.add_argument("--language-year-start", type=int, default=1950)
    ap.add_argument("--language-year-pages", type=int, default=2, help="pages to fetch per release year slice for each prioritized language")
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    init_db(conn)
    db_lock = Lock()

    known_ids = set() if args.refresh else existing_ids(conn)
    target = args.limit
    if target > 0 and len(known_ids) >= target:
        print(f"already have {len(known_ids)} rows ≥ target {target}. (pass --refresh to redo.)")
        return

    summaries_to_process: list[dict] = []
    seen_in_run: set[int] = set()
    streams = build_streams(args)

    # Collect summary pages until we have enough new candidates.
    target_msg = "all configured candidates" if target == 0 else f"up to {target - len(known_ids)} new candidate IDs"
    print(f"collecting {target_msg} across {len(streams)} summary streams…")
    with httpx.Client() as client:
        for stream in streams:
            page = 1
            while True:
                if target > 0 and len(summaries_to_process) + len(known_ids) >= target:
                    break
                if stream.page_limit is not None and page > stream.page_limit:
                    break
                try:
                    summaries = summary_page(client, stream, page)
                except Exception as e:
                    if is_terminal_page_error(e):
                        print(f"{stream.name} page {page} hit TMDB pagination boundary; stopping stream")
                        break
                    print(f"{stream.name} page {page} failed: {e}; sleeping 5s")
                    time.sleep(5)
                    continue
                if not summaries:
                    break
                for s in summaries:
                    if s["id"] in known_ids or s["id"] in seen_in_run:
                        continue
                    summaries_to_process.append(s)
                    seen_in_run.add(s["id"])
                    if target > 0 and len(summaries_to_process) + len(known_ids) >= target:
                        break
                page += 1
            if target > 0 and len(summaries_to_process) + len(known_ids) >= target:
                break

    if not summaries_to_process:
        print("nothing to fetch.")
        return

    print(f"fetching details for {len(summaries_to_process)} movies across {args.workers} workers…")

    def fetch_one(summary: dict) -> dict | None:
        with httpx.Client() as client:
            details = fetch_details(client, summary["id"])
            if not details:
                return None
            return normalize(details, summary)

    fetched = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_one, s): s for s in summaries_to_process}
        with tqdm(total=len(futures), desc="details") as pbar:
            for fut in as_completed(futures):
                record = fut.result()
                pbar.update(1)
                if not record:
                    continue
                with db_lock:
                    upsert(conn, record)
                    if fetched % 100 == 0:
                        conn.commit()
                fetched += 1
        conn.commit()

    conn.close()
    print(f"done. wrote {fetched} new rows to {DB_PATH}")


if __name__ == "__main__":
    main()
