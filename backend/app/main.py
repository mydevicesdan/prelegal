import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db import connect, reset_database

DEFAULT_DB_PATH = Path("/tmp/prelegal.db")


def create_app(db_path: Path | None = None, static_dir: Path | None = None) -> FastAPI:
    db_path = db_path or Path(os.environ.get("PRELEGAL_DB_PATH", DEFAULT_DB_PATH))
    static_dir = static_dir or Path(os.environ.get("PRELEGAL_STATIC_DIR", "static"))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        reset_database(db_path)
        yield

    app = FastAPI(title="Prelegal", lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        conn = connect(db_path)
        try:
            conn.execute("SELECT 1 FROM users LIMIT 1")
        finally:
            conn.close()
        return {"status": "ok"}

    # Mounted last so it never shadows /api routes. The frontend is a static export.
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")

    return app


app = create_app()
