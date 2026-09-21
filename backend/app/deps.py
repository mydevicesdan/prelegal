"""FastAPI dependencies shared by the API routers."""

import sqlite3
from collections.abc import Iterator

from fastapi import Depends, HTTPException, Request

from app.auth import SESSION_COOKIE, user_for_token
from app.db import connect


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    """A connection for the duration of the request. Handlers commit explicitly, so a client that has been
    answered can always see what it just wrote."""
    conn = connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


def current_user(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> sqlite3.Row:
    user = user_for_token(conn, request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(401, "Please sign in.")
    return user


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def chat_rate_limit(request: Request, user: sqlite3.Row = Depends(current_user)) -> sqlite3.Row:
    """The signed-in user, provided they have not sent too many chat messages lately (each one costs a model call)."""
    if not request.app.state.chat_limiter.allow(str(user["id"])):
        raise HTTPException(429, "You're sending messages too quickly. Please wait a moment and try again.")
    return user
