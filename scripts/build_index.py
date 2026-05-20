"""Embed every movie's text with a local sentence-transformers model and write
a FAISS index + id map.

Reads from data/movies.db (rows produced by fetch_tmdb.py),
writes data/movies.faiss and data/movies.faiss.ids.json.

Usage:
    python scripts/build_index.py
    python scripts/build_index.py --batch 64
    python scripts/build_index.py --model BAAI/bge-base-en-v1.5

Device selection is automatic: cuda > mps (Apple Silicon) > cpu.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "apps" / "api" / ".env")
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.embeddings import DEFAULT_EMBEDDING_MODEL, get_embedding_spec
from app.text_profiles import build_text_profile

DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "movies.db"
FAISS_PATH = DATA_DIR / "movies.faiss"
TONE_FAISS_PATH = DATA_DIR / "movies.tone.faiss"
IDS_PATH = DATA_DIR / "movies.faiss.ids.json"
META_PATH = DATA_DIR / "movies.faiss.meta.json"

DEFAULT_MODEL = os.environ.get("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)


def pick_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def ensure_schema(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(movies)").fetchall()}
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
    conn.commit()


def encode_batches(model, texts: list[str], batch_size: int) -> np.ndarray:
    chunks: list[np.ndarray] = []
    total = len(texts)
    for batch_index, start in enumerate(range(0, total, batch_size), start=1):
        batch = texts[start : start + batch_size]
        vectors = model.encode(
            batch,
            batch_size=len(batch),
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        ).astype(np.float32)
        chunks.append(vectors)
        if batch_index == 1 or batch_index % 50 == 0 or start + len(batch) >= total:
            print(
                f"encoded batch {batch_index} / {math.ceil(total / batch_size)} "
                f"({start + len(batch)} / {total})",
                flush=True,
            )
    return np.concatenate(chunks, axis=0)


def row_to_movie(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "year": row["year"],
        "language": row["language"] if "language" in row.keys() else None,
        "overview": row["overview"],
        "genres": json.loads(row["genres"]) if row["genres"] else [],
        "cast": json.loads(row["cast"]) if row["cast"] else [],
        "director": row["director"],
        "keywords": json.loads(row["keywords"]) if row["keywords"] else [],
        "tone_tags": json.loads(row["tone_tags"]) if "tone_tags" in row.keys() and row["tone_tags"] else [],
        "tone_text": row["tone_text"] if "tone_text" in row.keys() else None,
    }


def backfill_text_profiles(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT * FROM movies ORDER BY id").fetchall()
    updates: list[tuple[str, str, str, int]] = []
    for row in rows:
        movie = row_to_movie(row)
        profile = build_text_profile(movie)
        updates.append(
            (
                profile["embedding_text"],
                json.dumps(profile["tone_tags"]),
                profile["tone_text"],
                row["id"],
            )
        )
    conn.executemany(
        """
        UPDATE movies
        SET embedding_text = ?, tone_tags = ?, tone_text = ?
        WHERE id = ?
        """,
        updates,
    )
    conn.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--device", choices=("cpu", "cuda", "mps"))
    ap.add_argument("--local-files-only", action="store_true")
    args = ap.parse_args()

    if not DB_PATH.exists():
        sys.exit(f"{DB_PATH} not found — run scripts/fetch_tmdb.py first")

    from sentence_transformers import SentenceTransformer

    device = args.device or pick_device()
    spec = get_embedding_spec(args.model)
    print(f"loading {args.model} on {device}…")
    model = SentenceTransformer(
        args.model,
        device=device,
        local_files_only=args.local_files_only,
    )
    dim = model.get_sentence_embedding_dimension()
    print(f"embedding dim: {dim}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    backfill_text_profiles(conn)
    rows = conn.execute(
        """
        SELECT id, embedding_text, tone_text
        FROM movies
        WHERE embedding_text IS NOT NULL AND tone_text IS NOT NULL
        ORDER BY id
        """
    ).fetchall()
    conn.close()

    if not rows:
        sys.exit("no rows to embed")

    ids: list[int] = [r["id"] for r in rows]
    texts: list[str] = [spec.prepare_corpus_text(r["embedding_text"]) for r in rows]
    tone_texts: list[str] = [spec.prepare_corpus_text(r["tone_text"]) for r in rows]

    print(f"embedding {len(texts)} movies for content + tone indices…")
    vectors = encode_batches(model, texts, args.batch)
    tone_vectors = encode_batches(model, tone_texts, args.batch)

    if vectors.shape[1] != dim or tone_vectors.shape[1] != dim:
        sys.exit(
            f"unexpected embedding shapes content={vectors.shape}, tone={tone_vectors.shape}; expected dim {dim}"
        )

    import faiss

    content_index = faiss.IndexFlatIP(dim)
    content_index.add(vectors)
    tone_index = faiss.IndexFlatIP(dim)
    tone_index.add(tone_vectors)

    faiss.write_index(content_index, str(FAISS_PATH))
    faiss.write_index(tone_index, str(TONE_FAISS_PATH))
    IDS_PATH.write_text(json.dumps(ids))
    META_PATH.write_text(
        json.dumps(
            {
                "embedding_model": args.model,
                "embedding_dim": dim,
                "corpus_prefix": spec.corpus_prefix,
                "query_prefix": spec.query_prefix,
                "count": len(ids),
                "built_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
    )
    print(
        f"wrote {FAISS_PATH}, {TONE_FAISS_PATH} "
        f"({content_index.ntotal} vectors each, dim {dim}) and {IDS_PATH}"
    )


if __name__ == "__main__":
    main()
