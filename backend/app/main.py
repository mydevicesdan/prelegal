import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.auth_api import router as auth_router
from app.bodylimit import BodySizeLimit
from app.chat import router as chat_router
from app.db import reset_database, session
from app.documents_api import router as documents_router
from app.drafts_api import router as drafts_router
from app.ratelimit import RateLimiter
from app.static import FrontendFiles

DEFAULT_DB_PATH = Path("/tmp/prelegal.db")


def _limit(name: str, default: int) -> int:
    value = os.environ.get(name, "")
    return int(value) if value.isdigit() and int(value) > 0 else default


def create_app(db_path: Path | None = None, static_dir: Path | None = None) -> FastAPI:
    db_path = db_path or Path(os.environ.get("PRELEGAL_DB_PATH", DEFAULT_DB_PATH))
    static_dir = static_dir or Path(os.environ.get("PRELEGAL_STATIC_DIR", "static"))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        reset_database(db_path)
        yield

    app = FastAPI(title="Prelegal", lifespan=lifespan)
    app.state.db_path = db_path
    app.add_middleware(BodySizeLimit)
    # Limits are per process and reset with the server, like the (temporary) database. Each can be changed
    # through the environment, e.g. PRELEGAL_CHATS_PER_MINUTE=60.
    app.state.login_limiter = RateLimiter(_limit("PRELEGAL_FAILED_LOGINS", 10), 15 * 60)  # per address+email, 15 min
    app.state.login_ip_limiter = RateLimiter(_limit("PRELEGAL_FAILED_LOGINS_PER_ADDRESS", 50), 15 * 60)  # failures per address
    app.state.signup_limiter = RateLimiter(_limit("PRELEGAL_SIGNUPS_PER_HOUR", 20), 3600)  # per address
    app.state.chat_limiter = RateLimiter(_limit("PRELEGAL_CHATS_PER_MINUTE", 20), 60)  # per user

    @app.get("/api/health")
    def health() -> dict[str, str]:
        with session(db_path) as conn:
            conn.execute("SELECT 1 FROM users LIMIT 1")
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(drafts_router)
    app.include_router(chat_router)
    app.include_router(documents_router)

    # Mounted last so it never shadows /api routes. The frontend is a static export.
    if static_dir.is_dir():
        app.mount("/", FrontendFiles(directory=static_dir, html=True), name="frontend")

    return app


app = create_app()
