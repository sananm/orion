from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "apps" / "api" / ".env")
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.index_store import get_store
from app.reddit import reddit_enabled


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50, help="popular movies to enrich when --movie-id is not used")
    ap.add_argument("--movie-id", type=int, action="append", default=[], help="specific movie ID to enrich")
    ap.add_argument("--force", action="store_true", help="refresh even if cached")
    args = ap.parse_args()

    if not reddit_enabled():
        sys.exit("Reddit API credentials not configured in apps/api/.env")

    store = get_store()
    if args.movie_id:
        result = store.enrich_reddit_batch(limit=len(args.movie_id), force=args.force, movie_ids=args.movie_id)
    else:
        result = store.enrich_reddit_batch(limit=args.limit, force=args.force)
    print(result)


if __name__ == "__main__":
    main()
