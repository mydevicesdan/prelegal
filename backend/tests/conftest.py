from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

USER = {"name": "Ada Lovelace", "email": "ada@example.com", "password": "correct horse battery"}


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def static_dir(tmp_path: Path) -> Path:
    site = tmp_path / "site"
    (site / "documents").mkdir(parents=True)
    (site / "index.html").write_text("<h1>sign in</h1>")
    (site / "documents" / "index.html").write_text("<h1>my documents</h1>")
    return site


@pytest.fixture
def app(db_path: Path, static_dir: Path):
    return create_app(db_path, static_dir)


@pytest.fixture
def client(app):
    """Not signed in."""
    with TestClient(app) as c:
        yield c


def sign_up(client: TestClient, **overrides) -> dict:
    response = client.post("/api/auth/signup", json={**USER, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def user_client(client: TestClient):
    """Signed in as USER (the test client keeps the session cookie)."""
    sign_up(client)
    return client


@pytest.fixture
def other_client(app, client):
    """A second browser, signed in as a different user. It shares the running app (entering a second TestClient
    context would restart the app and reset its temporary database)."""
    c = TestClient(app)
    sign_up(c, name="Grace Hopper", email="grace@example.com")
    return c
