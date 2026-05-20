# Movie Constellation

A graph-based movie recommendation web app, presented as an explorable star constellation. Pick a few seed movies; each becomes a bright star whose top-K similar movies orbit nearby. Drag to pan, scroll/trackpad or use the zoom slider to zoom, single-click a star for details, double-click to spawn more neighbors, and like/dislike from the detail card. Seed labels stay visible when zoomed out; zoom in to reveal labels for all visible nodes. Likes auto-spawn neighbors and bias future recommendations.

## Stack

- **Frontend**: React + Vite + Three.js (@react-three/fiber + drei) + Tailwind + Zustand
- **Backend**: FastAPI + FAISS (IndexFlatIP) + SQLite
- **Embeddings**: local `sentence-transformers` (default `BAAI/bge-base-en-v1.5`, 768-d) over TMDB metadata — no API key needed
- **Data**: a broad local TMDB-derived corpus (popular, top-rated, and yearly slices)

## Setup

### Prerequisites

- Python 3.11+
- Node 20+ and `pnpm` (or `npm`)
- TMDB v3 API key — https://www.themoviedb.org/settings/api

No paid API key is required. Embeddings run locally on CPU (or GPU/MPS if available); the default model is larger and slower than the old small BGE model, but gives better recommendation quality.

### 1) Backend

```bash
cd apps/api
cp .env.example .env
# edit .env with your TMDB_API_KEY
# optional: add Reddit API credentials for community tone enrichment

python -m venv .venv
source .venv/bin/activate
pip install -e .
```

### 2) Build the corpus (one-time)

From the repo root, after the venv is active:

```bash
# quick dev pull
python scripts/fetch_tmdb.py --limit 200
python scripts/build_index.py

# broad real corpus
python scripts/fetch_tmdb.py --limit 50000
python scripts/build_index.py

# exhaust all configured discovery streams for the biggest local corpus
python scripts/fetch_tmdb.py --limit 0
python scripts/build_index.py

# swap models if you want stronger (slower) or lighter embeddings:
# python scripts/build_index.py --model BAAI/bge-base-en-v1.5
# python scripts/build_index.py --model mixedbread-ai/mxbai-embed-large-v1
# python scripts/build_index.py --model sentence-transformers/all-MiniLM-L6-v2
```

`fetch_tmdb.py` now mixes:
- global popularity
- TMDB top rated
- yearly popularity slices across decades

`build_index.py` now writes:
- `data/movies.db`
- `data/movies.faiss` for content similarity
- `data/movies.tone.faiss` for tone/feel similarity
- `data/movies.faiss.meta.json` so the running API knows which embedding model built the index

If you change `EMBEDDING_MODEL`, rebuild the index before running the API again. The backend now detects model/index mismatches and refuses to append new movies into a stale index.

### 3) Run the API

```bash
cd apps/api
./.venv/bin/python run_dev.py
```

Test:

```bash
curl http://localhost:8000/api/health
curl "http://localhost:8000/api/search?q=inception"
```

`run_dev.py` enables reload but only watches `apps/api/app`, which avoids
watching `.venv/` and the reload loop that can happen with plain
`uvicorn --reload`.

### Optional: Reddit tone enrichment

If you want Reddit community tone to influence recommendations, add these to
`apps/api/.env`:

```bash
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USER_AGENT=movie-constellation/0.1 by u/your_reddit_username
```

Then enrich some movies:

```bash
python scripts/enrich_reddit.py --limit 100
# or a specific movie:
python scripts/enrich_reddit.py --movie-id 600354
```

The API also exposes:

```bash
curl -X POST "http://localhost:8000/api/admin/reddit/enrich?limit=100"
curl -X POST "http://localhost:8000/api/admin/reddit/enrich/600354"
```

Only derived Reddit tone tags/cues are stored in SQLite; raw Reddit comment
text is not persisted.

### 4) Run the frontend

```bash
cd apps/web
cp .env.example .env
pnpm install
pnpm dev
```

Open http://localhost:5173.

## Project layout

```
apps/
  web/                       # React + Vite + R3F
    src/
      scene/                 # Three.js scene (Starfield, MovieNode, Edges, DragPanControls)
      ui/                    # SeedSearch, MovieDetailCard, Hud
      store/constellation.ts # Zustand state
      store/viewport.ts      # shared zoom state
      api/client.ts          # fetch wrappers
  api/                       # FastAPI
    app/
      main.py                # routes
      search.py              # /api/search
      similar.py             # /api/similar  (vector kNN + re-rank by liked/disliked)
      movie.py               # /api/movie/{id}
      index_store.py         # FAISS + SQLite loader
      config.py
data/                        # produced by pipeline, gitignored
scripts/
  fetch_tmdb.py
  build_index.py
```

## How recommendations work

For a clicked movie *m* with the user's `likedIds` and `dislikedIds`, the app:

```
score(c) =
  0.52 · content_similarity(c, m)
  + 0.48 · tone_similarity(c, m)
  + metadata_bonus(c, m)
  + liked/disliked centroid bias
```

Content similarity is computed from title/overview/genres/director/cast/keywords.
Tone similarity is computed from inferred tone tags and mood cues extracted from
the movie's metadata. If Reddit enrichment is enabled and cached, a community
tone bonus from Reddit discussion tags/cues is added during reranking.

## v1 caveats

- Auth is still minimal: local email/password only, no email verification, reset flow, or OAuth provider management yet.
- Layout now uses exclusion fields plus a lightweight relaxation pass, but very large constellations can still become label-dense when fully zoomed in.
- TMDB rate limits make the initial 50K fetch slow; pull in batches and resume with `--start-page`.
