"""Backfill IMDb IDs and official IMDb ratings into data/movies.db.

Uses IMDb's official non-commercial datasets as the primary source:
- `title.basics.tsv.gz` to map local movies to IMDb `tconst`
- `title.ratings.tsv.gz` for official IMDb ratings/vote counts

TMDB external IDs remain available as an optional slow fallback for titles that
cannot be resolved confidently by title/year matching.

Usage:
    python scripts/enrich_imdb_ratings.py
    python scripts/enrich_imdb_ratings.py --refresh-download
    python scripts/enrich_imdb_ratings.py --skip-tmdb
"""
from __future__ import annotations

import argparse
import csv
import gzip
import os
import re
import shutil
import sqlite3
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm import tqdm

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "apps" / "api" / ".env")
sys.path.insert(0, str(ROOT / "apps" / "api"))

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
TMDB_BASE = "https://api.themoviedb.org/3"
IMDB_BASICS_URL = "https://datasets.imdbws.com/title.basics.tsv.gz"
IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
ALLOWED_TITLE_TYPES = {"movie", "tvMovie"}

DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "movies.db"
TITLE_BASICS_PATH = DATA_DIR / "title.basics.tsv.gz"
RATINGS_PATH = DATA_DIR / "title.ratings.tsv.gz"


def ensure_schema(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(movies)").fetchall()}
    if "imdb_id" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN imdb_id TEXT")
    if "imdb_rating" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN imdb_rating REAL")
    if "imdb_vote_count" not in columns:
        conn.execute("ALTER TABLE movies ADD COLUMN imdb_vote_count INTEGER")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS imdb_ratings_cache (
            imdb_id TEXT PRIMARY KEY,
            imdb_rating REAL,
            imdb_vote_count INTEGER
        )
    """)
    conn.commit()


@dataclass(frozen=True)
class TitleTarget:
    movie_id: int
    title: str
    year: int
    normalized_title: str


@dataclass(frozen=True)
class TitleCandidate:
    imdb_id: str
    year: int
    title_type: str


def normalize_title(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_text = ascii_text.lower().replace("&", " and ")
    ascii_text = re.sub(r"[^a-z0-9]+", " ", ascii_text)
    return re.sub(r"\s+", " ", ascii_text).strip()


def _parse_year(raw: str | None) -> int | None:
    if not raw or raw == r"\N":
        return None
    return int(raw) if raw.isdigit() else None


def _download_dataset(url: str, destination: Path, refresh_download: bool) -> None:
    if destination.exists() and not refresh_download:
        print(f"using existing IMDb dataset at {destination}")
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = destination.with_suffix(destination.suffix + ".tmp")
    with httpx.stream("GET", url, timeout=120) as response:
        response.raise_for_status()
        with tmp_path.open("wb") as fh:
            for chunk in response.iter_bytes():
                fh.write(chunk)
    shutil.move(str(tmp_path), str(destination))
    print(f"downloaded {destination.name} to {destination}")


@retry(stop=stop_after_attempt(5), wait=wait_exponential(min=1, max=20))
def tmdb_get(client: httpx.Client, path: str, **params) -> dict:
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY not set")
    params["api_key"] = TMDB_API_KEY
    response = client.get(f"{TMDB_BASE}{path}", params=params, timeout=20)
    response.raise_for_status()
    return response.json()


def fetch_external_id(movie_id: int) -> tuple[int, str | None]:
    with httpx.Client() as client:
        try:
            data = tmdb_get(client, f"/movie/{movie_id}/external_ids")
        except Exception:
            return movie_id, None
    imdb_id = data.get("imdb_id")
    return movie_id, imdb_id if isinstance(imdb_id, str) and imdb_id.strip() else None


def backfill_imdb_ids(conn: sqlite3.Connection, workers: int, limit: int, refresh_ids: bool) -> int:
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY not set")

    where = "" if refresh_ids else "WHERE imdb_id IS NULL OR imdb_id = ''"
    limit_clause = f"LIMIT {limit}" if limit > 0 else ""
    rows = conn.execute(
        f"""
        SELECT id FROM movies
        {where}
        ORDER BY popularity DESC
        {limit_clause}
        """
    ).fetchall()
    movie_ids = [int(row[0]) for row in rows]
    if not movie_ids:
        print("all movies already have imdb_id")
        return 0

    updates: list[tuple[str, int]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch_external_id, movie_id): movie_id for movie_id in movie_ids}
        with tqdm(total=len(futures), desc="tmdb external ids") as progress:
            for future in as_completed(futures):
                movie_id, imdb_id = future.result()
                progress.update(1)
                if imdb_id:
                    updates.append((imdb_id, movie_id))

    if updates:
        conn.executemany(
            "UPDATE movies SET imdb_id = ? WHERE id = ?",
            updates,
        )
        conn.commit()

    print(f"backfilled imdb_id for {len(updates)} / {len(movie_ids)} movies")
    return len(updates)


def collect_title_targets(conn: sqlite3.Connection, limit: int, refresh_ids: bool) -> list[TitleTarget]:
    where = "" if refresh_ids else "WHERE imdb_id IS NULL OR imdb_id = ''"
    limit_clause = f"LIMIT {limit}" if limit > 0 else ""
    rows = conn.execute(
        """
        SELECT id, title, year
        FROM movies
        {where}
        ORDER BY popularity DESC
        {limit_clause}
        """
        .format(where=where, limit_clause=limit_clause)
    ).fetchall()

    targets: list[TitleTarget] = []
    for movie_id, title, year in rows:
        normalized_title = normalize_title(title)
        if not normalized_title or year is None:
            continue
        targets.append(
            TitleTarget(
                movie_id=int(movie_id),
                title=str(title),
                year=int(year),
                normalized_title=normalized_title,
            )
        )
    return targets


def resolve_title_candidate(
    conn: sqlite3.Connection,
    target: TitleTarget,
    candidates: list[TitleCandidate],
) -> str | None:
    best_by_id: dict[str, tuple[int, int, int]] = {}
    for candidate in candidates:
        year_delta = abs(candidate.year - target.year)
        score = (4 if year_delta == 0 else 2) + (2 if candidate.title_type == "movie" else 1)
        title_type_rank = 0 if candidate.title_type == "movie" else 1
        previous = best_by_id.get(candidate.imdb_id)
        payload = (score, year_delta, title_type_rank)
        if previous is None or payload > previous:
            best_by_id[candidate.imdb_id] = payload

    if not best_by_id:
        return None

    ranked = sorted(
        best_by_id.items(),
        key=lambda item: (-item[1][0], item[1][1], item[1][2], item[0]),
    )
    if len(ranked) == 1 or ranked[0][1] < ranked[1][1]:
        return ranked[0][0]

    tied = [imdb_id for imdb_id, payload in ranked if payload == ranked[0][1]]
    placeholders = ",".join("?" for _ in tied)
    vote_rows = conn.execute(
        f"""
        SELECT imdb_id, imdb_vote_count
        FROM imdb_ratings_cache
        WHERE imdb_id IN ({placeholders})
        """,
        tied,
    ).fetchall()
    if vote_rows:
        votes = {str(imdb_id): int(imdb_vote_count or 0) for imdb_id, imdb_vote_count in vote_rows}
        ranked_by_votes = sorted(tied, key=lambda imdb_id: (-votes.get(imdb_id, 0), imdb_id))
        if len(ranked_by_votes) == 1:
            return ranked_by_votes[0]
        if votes.get(ranked_by_votes[0], 0) > votes.get(ranked_by_votes[1], 0):
            return ranked_by_votes[0]
    return None


def backfill_imdb_ids_from_basics(
    conn: sqlite3.Connection,
    basics_path: Path,
    limit: int,
    refresh_ids: bool,
) -> int:
    targets = collect_title_targets(conn, limit, refresh_ids)
    if not targets:
        print("no movies need IMDb title matching")
        return 0

    targets_by_title: dict[str, list[TitleTarget]] = {}
    for target in targets:
        targets_by_title.setdefault(target.normalized_title, []).append(target)

    candidates_by_movie: dict[int, list[TitleCandidate]] = {}
    with gzip.open(basics_path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            title_type = row.get("titleType") or ""
            if title_type not in ALLOWED_TITLE_TYPES:
                continue
            year = _parse_year(row.get("startYear"))
            if year is None:
                continue
            names = {
                normalize_title(row.get("primaryTitle")),
                normalize_title(row.get("originalTitle")),
            }
            names.discard("")
            imdb_id = row.get("tconst")
            if not imdb_id:
                continue
            for normalized_title in names:
                for target in targets_by_title.get(normalized_title, []):
                    if abs(year - target.year) > 1:
                        continue
                    candidates_by_movie.setdefault(target.movie_id, []).append(
                        TitleCandidate(imdb_id=imdb_id, year=year, title_type=title_type)
                    )

    updates: list[tuple[str, int]] = []
    ambiguous = 0
    for target in targets:
        imdb_id = resolve_title_candidate(conn, target, candidates_by_movie.get(target.movie_id, []))
        if imdb_id:
            updates.append((imdb_id, target.movie_id))
        elif target.movie_id in candidates_by_movie:
            ambiguous += 1

    if updates:
        conn.executemany("UPDATE movies SET imdb_id = ? WHERE id = ?", updates)
        conn.commit()

    print(
        f"matched IMDb ids for {len(updates)} / {len(targets)} movies "
        f"from title.basics ({ambiguous} ambiguous)"
    )
    return len(updates)


def load_ratings_cache(conn: sqlite3.Connection, ratings_path: Path, refresh_cache: bool) -> int:
    existing = conn.execute("SELECT COUNT(*) FROM imdb_ratings_cache").fetchone()[0]
    if existing and not refresh_cache:
        print(f"using existing IMDb ratings cache with {existing} rows")
        return int(existing)

    if refresh_cache:
        conn.execute("DELETE FROM imdb_ratings_cache")
        conn.commit()

    buffer: list[tuple[str, float, int]] = []
    inserted = 0
    with gzip.open(ratings_path, "rt", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        for row in reader:
            try:
                imdb_rating = float(row["averageRating"])
                imdb_vote_count = int(row["numVotes"])
            except (TypeError, ValueError):
                continue
            imdb_id = row["tconst"]
            buffer.append((imdb_id, imdb_rating, imdb_vote_count))
            if len(buffer) >= 50000:
                conn.executemany(
                    """
                    INSERT INTO imdb_ratings_cache (imdb_id, imdb_rating, imdb_vote_count)
                    VALUES (?, ?, ?)
                    ON CONFLICT(imdb_id) DO UPDATE SET
                        imdb_rating=excluded.imdb_rating,
                        imdb_vote_count=excluded.imdb_vote_count
                    """,
                    buffer,
                )
                conn.commit()
                inserted += len(buffer)
                buffer.clear()

    if buffer:
        conn.executemany(
            """
            INSERT INTO imdb_ratings_cache (imdb_id, imdb_rating, imdb_vote_count)
            VALUES (?, ?, ?)
            ON CONFLICT(imdb_id) DO UPDATE SET
                imdb_rating=excluded.imdb_rating,
                imdb_vote_count=excluded.imdb_vote_count
            """,
            buffer,
        )
        conn.commit()
        inserted += len(buffer)
    print(f"loaded IMDb ratings cache with {inserted} rows")
    return inserted


def backfill_imdb_ratings(conn: sqlite3.Connection) -> int:
    matched = conn.execute(
        """
        SELECT COUNT(*)
        FROM movies
        WHERE imdb_id IS NOT NULL
          AND imdb_id != ''
          AND imdb_id IN (SELECT imdb_id FROM imdb_ratings_cache)
        """
    ).fetchone()[0]
    if not matched:
        print("no IMDb ratings matched local imdb_id values")
        return 0

    conn.execute(
        """
        UPDATE movies
        SET imdb_rating = (
                SELECT imdb_rating
                FROM imdb_ratings_cache
                WHERE imdb_ratings_cache.imdb_id = movies.imdb_id
            ),
            imdb_vote_count = (
                SELECT imdb_vote_count
                FROM imdb_ratings_cache
                WHERE imdb_ratings_cache.imdb_id = movies.imdb_id
            )
        WHERE imdb_id IS NOT NULL
          AND imdb_id != ''
          AND imdb_id IN (SELECT imdb_id FROM imdb_ratings_cache)
        """
    )
    conn.commit()
    print(f"backfilled IMDb ratings for {matched} titles")
    return int(matched)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=20)
    parser.add_argument("--limit", type=int, default=0, help="limit IMDb id backfill count; 0 = all missing")
    parser.add_argument("--skip-tmdb", action="store_true", help="skip optional TMDB imdb_id fallback")
    parser.add_argument("--refresh-ids", action="store_true", help="re-fetch imdb_id for all movies, not just missing ones")
    parser.add_argument("--refresh-download", action="store_true", help="re-download the IMDb ratings dataset")
    parser.add_argument("--tmdb-fallback-limit", type=int, default=0, help="optional TMDB external-id fallback count after IMDb title matching")
    args = parser.parse_args()

    if not DB_PATH.exists():
        sys.exit(f"{DB_PATH} not found")

    conn = sqlite3.connect(DB_PATH)
    ensure_schema(conn)

    _download_dataset(IMDB_BASICS_URL, TITLE_BASICS_PATH, args.refresh_download)
    _download_dataset(IMDB_RATINGS_URL, RATINGS_PATH, args.refresh_download)

    load_ratings_cache(conn, RATINGS_PATH, refresh_cache=args.refresh_download)
    backfill_imdb_ids_from_basics(conn, TITLE_BASICS_PATH, args.limit, args.refresh_ids)

    if not args.skip_tmdb and args.tmdb_fallback_limit > 0:
        backfill_imdb_ids(conn, args.workers, args.tmdb_fallback_limit, refresh_ids=False)

    backfill_imdb_ratings(conn)
    conn.close()


if __name__ == "__main__":
    main()
