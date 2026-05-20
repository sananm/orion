from __future__ import annotations

from datetime import datetime, timedelta, timezone
import threading
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import get_settings
from .reddit_profiles import build_reddit_backup_query, build_reddit_query, extract_reddit_profile

AUTH_BASE = "https://www.reddit.com"
OAUTH_BASE = "https://oauth.reddit.com"

_client: httpx.Client | None = None
_token: str | None = None
_token_expires_at: datetime | None = None
_token_lock = threading.Lock()


def reddit_enabled() -> bool:
    s = get_settings()
    return bool(s.reddit_client_id and s.reddit_client_secret and s.reddit_user_agent)


def _http() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=20)
    return _client


def _token_is_fresh() -> bool:
    return bool(_token and _token_expires_at and datetime.now(timezone.utc) < _token_expires_at)


def _fetch_access_token() -> str:
    s = get_settings()
    response = _http().post(
        f"{AUTH_BASE}/api/v1/access_token",
        auth=(s.reddit_client_id, s.reddit_client_secret),
        headers={"User-Agent": s.reddit_user_agent},
        data={"grant_type": "client_credentials"},
    )
    response.raise_for_status()
    payload = response.json()
    expires_in = int(payload.get("expires_in") or 3600)

    global _token, _token_expires_at
    _token = payload["access_token"]
    _token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(60, expires_in - 120))
    return _token


def _access_token() -> str:
    if _token_is_fresh():
        return _token  # type: ignore[return-value]
    with _token_lock:
        if _token_is_fresh():
            return _token  # type: ignore[return-value]
        return _fetch_access_token()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=6))
def _oauth_get(path: str, **params: Any) -> dict | list:
    if not reddit_enabled():
        raise RuntimeError("reddit not configured")
    headers = {
        "Authorization": f"bearer {_access_token()}",
        "User-Agent": get_settings().reddit_user_agent,
    }
    response = _http().get(f"{OAUTH_BASE}{path}", headers=headers, params=params)
    if response.status_code == 401:
        with _token_lock:
            global _token, _token_expires_at
            _token = None
            _token_expires_at = None
        headers["Authorization"] = f"bearer {_access_token()}"
        response = _http().get(f"{OAUTH_BASE}{path}", headers=headers, params=params)
    response.raise_for_status()
    return response.json()


def _search_posts(movie: dict) -> list[dict]:
    s = get_settings()
    queries = [build_reddit_query(movie), build_reddit_backup_query(movie)]
    seen: set[str] = set()
    posts: list[dict] = []

    for subreddit in s.reddit_subreddits:
        for query in queries:
            try:
                payload = _oauth_get(
                    f"/r/{subreddit}/search",
                    q=query,
                    restrict_sr="1",
                    sort="relevance",
                    t="all",
                    type="link",
                    limit=max(3, s.reddit_post_limit),
                    raw_json=1,
                )
            except Exception:
                continue

            children = (((payload or {}).get("data") or {}).get("children") or []) if isinstance(payload, dict) else []
            for child in children:
                data = child.get("data") or {}
                post_id = data.get("id")
                if not post_id or post_id in seen:
                    continue
                title = (data.get("title") or "").lower()
                movie_title = (movie.get("title") or "").lower()
                if movie_title and movie_title not in title and movie_title not in (data.get("selftext") or "").lower():
                    continue
                seen.add(post_id)
                posts.append(
                    {
                        "id": post_id,
                        "subreddit": data.get("subreddit") or subreddit,
                        "title": data.get("title") or "",
                        "selftext": data.get("selftext") or "",
                        "score": int(data.get("score") or 0),
                        "num_comments": int(data.get("num_comments") or 0),
                        "permalink": data.get("permalink") or "",
                    }
                )

    posts.sort(key=lambda post: (post["score"] + post["num_comments"] * 2), reverse=True)
    return posts[: s.reddit_post_limit]


def _collect_comments(children: list[dict], results: list[str], limit: int) -> None:
    for child in children:
        if len(results) >= limit:
            return
        if child.get("kind") != "t1":
            continue
        data = child.get("data") or {}
        body = (data.get("body") or "").strip()
        if body and body not in {"[deleted]", "[removed]"}:
            results.append(body)
        replies = data.get("replies")
        if isinstance(replies, dict):
            reply_children = (((replies or {}).get("data") or {}).get("children") or [])
            _collect_comments(reply_children, results, limit)


def _fetch_comments(post: dict) -> list[str]:
    s = get_settings()
    try:
        payload = _oauth_get(
            f"/r/{post['subreddit']}/comments/{post['id']}",
            sort="top",
            limit=s.reddit_comment_limit,
            depth=2,
            raw_json=1,
        )
    except Exception:
        return []
    if not isinstance(payload, list) or len(payload) < 2:
        return []
    children = ((((payload[1] or {}).get("data") or {}).get("children")) or [])
    results: list[str] = []
    _collect_comments(children, results, s.reddit_comment_limit)
    return results


def fetch_reddit_profile(movie: dict) -> dict | None:
    if not reddit_enabled():
        return None

    posts = _search_posts(movie)
    if not posts:
        return None

    texts: list[str] = []
    comment_count = 0
    for post in posts:
        if post["title"]:
            texts.append(post["title"])
        if post["selftext"]:
            texts.append(post["selftext"])
        comments = _fetch_comments(post)
        comment_count += len(comments)
        texts.extend(comments)

    profile = extract_reddit_profile(movie, texts)
    if not profile:
        return None

    profile["reddit_post_count"] = len(posts)
    profile["reddit_comment_count"] = comment_count
    profile["reddit_cached_at"] = datetime.now(timezone.utc).isoformat()
    return profile
