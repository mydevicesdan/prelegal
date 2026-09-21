import sqlite3
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


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_users_table_schema(client: TestClient, db_path: Path):
    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    assert columns == {"id", "email", "password_hash", "created_at"}


def test_email_is_unique(client: TestClient, db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'x')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'y')")
    conn.close()


def test_database_is_recreated_on_startup(db_path: Path, static_dir: Path):
    with TestClient(create_app(db_path, static_dir)):
        conn = sqlite3.connect(db_path)
        conn.execute("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'x')")
        conn.commit()
        conn.close()

    with TestClient(create_app(db_path, static_dir)):
        conn = sqlite3.connect(db_path)
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone() == (0,)
        conn.close()


def test_serves_login_page_at_root(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    assert "login" in response.text


def test_serves_nested_page_with_and_without_trailing_slash(client: TestClient):
    assert "nda" in client.get("/nda/").text
    assert "nda" in client.get("/nda").text


def test_unknown_api_route_is_not_swallowed_by_static_files(client: TestClient):
    assert client.get("/api/nope").status_code == 404


def test_app_starts_without_a_static_directory(db_path: Path, tmp_path: Path):
    with TestClient(create_app(db_path, tmp_path / "missing")) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/").status_code == 404
