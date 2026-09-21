from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    site = tmp_path / "site"
    (site / "nda").mkdir(parents=True)
    (site / "index.html").write_text("<h1>login</h1>")
    (site / "nda" / "index.html").write_text("<h1>nda</h1>")
    return site


@pytest.fixture
def client(db_path: Path, static_dir: Path):
    with TestClient(create_app(db_path, static_dir)) as c:
        yield c
