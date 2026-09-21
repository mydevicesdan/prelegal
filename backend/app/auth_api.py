import os
import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field, field_validator

from app import auth
from app.db import now_iso
from app.deps import client_ip, get_db
from app.schemas import WireModel

router = APIRouter(prefix="/api/auth")

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
MAX_PASSWORD = 128


class UserOut(WireModel):
    id: int
    name: str
    email: str


class LoginIn(WireModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=MAX_PASSWORD)

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str) -> str:
        return value.strip().lower()


class SignupIn(LoginIn):
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("name must not be blank")
        return value

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL.match(value):
            raise ValueError("enter a valid email address")
        return value


def _start_session(request: Request, response: Response, conn: sqlite3.Connection, user_id: int) -> None:
    token = auth.create_session(conn, user_id)
    conn.commit()
    secure = request.url.scheme == "https" or os.environ.get("PRELEGAL_COOKIE_SECURE") == "1"
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        max_age=auth.SESSION_DAYS * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


@router.post("/signup", response_model=UserOut, status_code=201, response_model_by_alias=True)
def signup(
    body: SignupIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)
) -> UserOut:
    if not request.app.state.signup_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many sign-ups from this address. Please try again later.")
    try:
        cursor = conn.execute(
            "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (body.email, body.name, auth.hash_password(body.password), now_iso()),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "An account with this email already exists. Try signing in instead.")
    _start_session(request, response, conn, cursor.lastrowid)
    return UserOut(id=cursor.lastrowid, name=body.name, email=body.email)


@router.post("/login", response_model=UserOut, response_model_by_alias=True)
def login(
    body: LoginIn, request: Request, response: Response, conn: sqlite3.Connection = Depends(get_db)
) -> UserOut:
    # Two limits: attempts on one account from one address, and failures from one address across all accounts
    # (otherwise a single address could try a password against any number of accounts).
    limiter = request.app.state.login_limiter
    ip = client_ip(request)
    key = f"{ip}|{body.email}"
    if request.app.state.login_ip_limiter.blocked(ip) or not limiter.allow(key):
        raise HTTPException(429, "Too many failed attempts. Please wait a few minutes and try again.")

    user = conn.execute("SELECT id, name, email, password_hash FROM users WHERE email = ?", (body.email,)).fetchone()
    if user is None:
        auth.waste_time_like_a_password_check(body.password)
    if user is None or not auth.verify_password(user["password_hash"], body.password):
        request.app.state.login_ip_limiter.record(ip)
        raise HTTPException(401, "Incorrect email or password.")

    limiter.reset(key)
    auth.delete_expired_sessions(conn)
    _start_session(request, response, conn, user["id"])
    return UserOut(id=user["id"], name=user["name"], email=user["email"])


@router.post("/logout", status_code=204)
def logout(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> Response:
    auth.end_session(conn, request.cookies.get(auth.SESSION_COOKIE))
    conn.commit()
    response = Response(status_code=204)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return response


class SessionOut(WireModel):
    user: UserOut | None


@router.get("/session", response_model=SessionOut, response_model_by_alias=True)
def session(request: Request, conn: sqlite3.Connection = Depends(get_db)) -> SessionOut:
    """Who is signed in, if anyone. Answers 200 either way: "nobody" is a normal answer, not an error."""
    user = auth.user_for_token(conn, request.cookies.get(auth.SESSION_COOKIE))
    return SessionOut(user=UserOut(id=user["id"], name=user["name"], email=user["email"]) if user else None)
