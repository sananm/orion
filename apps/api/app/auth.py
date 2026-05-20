from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
import secrets
import sqlite3
from typing import Any, Iterator

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from .config import get_settings

router = APIRouter()

PBKDF2_ITERATIONS = 600_000

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS account_states (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


def _hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iteration_text)
        salt = bytes.fromhex(salt_hex)
    except (ValueError, TypeError):
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        iterations,
    ).hex()
    return hmac.compare_digest(digest, digest_hex)


@contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(get_settings().db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    _ensure_schema(conn)
    try:
        yield conn
    finally:
        conn.close()


def _public_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "email": str(row["email"]),
        "displayName": str(row["display_name"]),
        "hasPassword": bool(row["password_hash"]),
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
    }


def _load_account_state(conn: sqlite3.Connection, user_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT snapshot_json FROM account_states WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        return None
    try:
        parsed = json.loads(row["snapshot_json"])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = _utc_now()
    conn.execute(
        """
        INSERT INTO auth_sessions (user_id, token_hash, created_at, last_seen_at)
        VALUES (?, ?, ?, ?)
        """,
        (user_id, _token_hash(token), now, now),
    )
    conn.commit()
    return token


def _extract_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing authorization")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid authorization")
    return token.strip()


def _current_user_from_header(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    token = _extract_token(authorization)
    token_digest = _token_hash(token)

    with _db() as conn:
        row = conn.execute(
            """
            SELECT users.*
            FROM auth_sessions
            JOIN users ON users.id = auth_sessions.user_id
            WHERE auth_sessions.token_hash = ?
            """,
            (token_digest,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid session")
        conn.execute(
            "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?",
            (_utc_now(), token_digest),
        )
        conn.commit()
        return _public_user(row)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)
    displayName: str = Field(min_length=1, max_length=64)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class ProfileRequest(BaseModel):
    displayName: str = Field(min_length=1, max_length=64)


class PasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=8, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class StateRequest(BaseModel):
    state: dict[str, Any]


@router.post("/auth/register")
def register(req: RegisterRequest):
    email = _normalize_email(str(req.email))
    display_name = req.displayName.strip()
    if not display_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="display name required")

    with _db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already exists")

        now = _utc_now()
        cursor = conn.execute(
            """
            INSERT INTO users (email, display_name, password_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (email, display_name, _hash_password(req.password), now, now),
        )
        conn.commit()
        user_id = int(cursor.lastrowid)
        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        token = _create_session(conn, user_id)
        return {"token": token, "user": _public_user(user), "state": None}


@router.post("/auth/login")
def login(req: LoginRequest):
    email = _normalize_email(str(req.email))
    with _db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not row or not _verify_password(req.password, str(row["password_hash"])):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email or password")
        token = _create_session(conn, int(row["id"]))
        state = _load_account_state(conn, int(row["id"]))
        return {"token": token, "user": _public_user(row), "state": state}


@router.get("/auth/me")
def me(user: dict[str, Any] = Depends(_current_user_from_header)):
    return {"user": user}


@router.post("/auth/logout")
def logout(
    user: dict[str, Any] = Depends(_current_user_from_header),
    authorization: str | None = Header(default=None),
):
    token = _extract_token(authorization)
    with _db() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_hash(token),))
        conn.commit()
    return {"ok": True, "userId": user["id"]}


@router.put("/auth/profile")
def update_profile(req: ProfileRequest, user: dict[str, Any] = Depends(_current_user_from_header)):
    display_name = req.displayName.strip()
    if not display_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="display name required")
    with _db() as conn:
        now = _utc_now()
        conn.execute(
            "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
            (display_name, now, user["id"]),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return {"user": _public_user(row)}


@router.put("/auth/password")
def change_password(req: PasswordRequest, user: dict[str, Any] = Depends(_current_user_from_header)):
    if req.currentPassword == req.newPassword:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="new password must differ")
    with _db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user not found")
        if not row["password_hash"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="this account uses google sign-in only")
        if not _verify_password(req.currentPassword, str(row["password_hash"])):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="current password is incorrect")
        now = _utc_now()
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (_hash_password(req.newPassword), now, user["id"]),
        )
        conn.commit()
    return {"ok": True}


@router.get("/account/state")
def get_account_state(user: dict[str, Any] = Depends(_current_user_from_header)):
    with _db() as conn:
        return {"state": _load_account_state(conn, user["id"])}


@router.put("/account/state")
def save_account_state(req: StateRequest, user: dict[str, Any] = Depends(_current_user_from_header)):
    snapshot_json = json.dumps(req.state)
    now = _utc_now()
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO account_states (user_id, snapshot_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json,
                updated_at = excluded.updated_at
            """,
            (user["id"], snapshot_json, now),
        )
        conn.commit()
    return {"ok": True, "updatedAt": now}
