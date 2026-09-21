"""Passwords and sessions.

Passwords are stored as argon2 hashes. A session is a random token held by the browser in an HttpOnly cookie;
the database stores only its SHA-256, so a leaked database cannot be replayed as sign-ins.
"""

import hashlib
import secrets
import sqlite3
import threading
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.db import now_iso

SESSION_COOKIE = "prelegal_session"
SESSION_DAYS = 30

_hasher = PasswordHasher()
# Each argon2 run uses tens of megabytes, so only a few may run at once: a flood of sign-in attempts then waits
# its turn instead of exhausting the server's memory.
_hashing = threading.BoundedSemaphore(4)
# Verified against when an email is unknown, so a wrong email and a wrong password take equally long.
_DUMMY_HASH = _hasher.hash("prelegal-dummy-password")


def hash_password(password: str) -> str:
    with _hashing:
        return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        with _hashing:
            return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def waste_time_like_a_password_check(password: str) -> None:
    verify_password(_DUMMY_HASH, password)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    """Starts a session for the user and returns the token to give to the browser."""
    token = secrets.token_urlsafe(32)
    expires = (datetime.now(UTC) + timedelta(days=SESSION_DAYS)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    conn.execute(
        "INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (user_id, _token_hash(token), now_iso(), expires),
    )
    return token


def user_for_token(conn: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    """The user the token belongs to, if it is a live session."""
    if not token:
        return None
    return conn.execute(
        "SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id "
        "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
        (_token_hash(token), now_iso()),
    ).fetchone()


def end_session(conn: sqlite3.Connection, token: str | None) -> None:
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


def delete_expired_sessions(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now_iso(),))
