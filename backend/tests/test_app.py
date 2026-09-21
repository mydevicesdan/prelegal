import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

INSERT_USER = "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, 'A', 'x', 'now')"


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_schema(client: TestClient, db_path: Path):
    with sqlite3.connect(db_path) as conn:
        columns = lambda table: {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}  # noqa: E731
        assert columns("users") == {"id", "email", "name", "password_hash", "created_at"}
        assert columns("sessions") == {"id", "user_id", "token_hash", "created_at", "expires_at"}
        assert columns("documents") == {
            "id", "user_id", "document_type", "companies", "state", "messages", "created_at", "updated_at",
        }


def test_email_is_unique(client: TestClient, db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.execute(INSERT_USER, ("a@b.co",))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(INSERT_USER, ("a@b.co",))
    conn.close()


def test_database_is_recreated_on_startup(db_path: Path, static_dir: Path):
    with TestClient(create_app(db_path, static_dir)):
        conn = sqlite3.connect(db_path)
        conn.execute(INSERT_USER, ("a@b.co",))
        conn.commit()
        conn.close()

    with TestClient(create_app(db_path, static_dir)):
        conn = sqlite3.connect(db_path)
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone() == (0,)
        conn.close()


def test_serves_the_sign_in_page_at_root(client: TestClient):
    response = client.get("/")
    assert response.status_code == 200
    assert "sign in" in response.text


def test_serves_nested_page_with_and_without_trailing_slash(client: TestClient):
    assert "my documents" in client.get("/documents/").text
    assert "my documents" in client.get("/documents").text


def test_unknown_api_route_is_not_swallowed_by_static_files(client: TestClient):
    assert client.get("/api/nope").status_code == 404


def test_app_starts_without_a_static_directory(db_path: Path, tmp_path: Path):
    with TestClient(create_app(db_path, tmp_path / "missing")) as c:
        assert c.get("/api/health").status_code == 200
        assert c.get("/").status_code == 404


class TestNextPayloadPaths:
    """Next.js prefetches dotted names (/documents/__next.documents.__PAGE__.txt); a static export nests the files."""

    @pytest.fixture
    def site(self, static_dir: Path, db_path: Path):
        nested = static_dir / "documents" / "__next.documents"
        nested.mkdir()
        (nested / "__PAGE__.txt").write_text("payload")
        (static_dir / "documents" / "__next._tree.txt").write_text("tree")
        with TestClient(create_app(db_path, static_dir)) as c:
            yield c

    def test_the_dotted_request_finds_the_nested_file(self, site: TestClient):
        response = site.get("/documents/__next.documents.__PAGE__.txt")
        assert response.status_code == 200 and response.text == "payload"

    def test_files_that_exist_as_requested_are_served_as_before(self, site: TestClient):
        assert site.get("/documents/__next._tree.txt").text == "tree"

    def test_unknown_payload_files_are_still_404(self, site: TestClient):
        assert site.get("/documents/__next.documents.__NOPE__.txt").status_code == 404
        assert site.get("/documents/__next.other.__PAGE__.txt").status_code == 404

    def test_the_mapping(self):
        from app.static import nested_payload_path

        assert nested_payload_path("signup/__next.signup.__PAGE__.txt") == "signup/__next.signup/__PAGE__.txt"
        assert nested_payload_path("a/b/__next.a.b.__PAGE__.txt") == "a/b/__next.a/b/__PAGE__.txt"
        assert nested_payload_path("__next.__PAGE__.txt") is None
        assert nested_payload_path("documents/__next._tree.txt") is None
        assert nested_payload_path("index.html") is None
        assert nested_payload_path(chr(92).join(["signup", "__next.signup.__PAGE__.txt"])) == "signup/__next.signup/__PAGE__.txt"


class TestBodySizeLimit:
    def test_an_oversized_body_is_refused_without_being_read(self, user_client):
        big = "x" * 4_100_000
        response = user_client.post("/api/chat", content=big, headers={"content-type": "application/json"})
        assert response.status_code == 413
        assert response.json() == {"detail": "That request is too large."}

    def test_a_normal_request_still_works(self, user_client):
        assert user_client.get("/api/drafts").status_code == 200

    def test_a_bad_content_length_is_refused(self, user_client):
        response = user_client.post(
            "/api/auth/login", content=b"{}", headers={"content-type": "application/json", "content-length": "abc"}
        )
        assert response.status_code in (400, 413)


class TestConfigurableLimits:
    def test_the_defaults_apply_when_nothing_is_set(self, app):
        assert (app.state.login_limiter.limit, app.state.signup_limiter.limit, app.state.chat_limiter.limit) == (10, 20, 20)

    def test_limits_can_be_changed_through_the_environment(self, db_path: Path, static_dir: Path, monkeypatch):
        monkeypatch.setenv("PRELEGAL_CHATS_PER_MINUTE", "60")
        monkeypatch.setenv("PRELEGAL_SIGNUPS_PER_HOUR", "500")
        monkeypatch.setenv("PRELEGAL_FAILED_LOGINS", "3")
        app = create_app(db_path, static_dir)
        assert (app.state.login_limiter.limit, app.state.signup_limiter.limit, app.state.chat_limiter.limit) == (3, 500, 60)

    @pytest.mark.parametrize("bad", ["", "abc", "0", "-5", "1.5"])
    def test_a_bad_value_falls_back_to_the_default(self, db_path: Path, static_dir: Path, monkeypatch, bad):
        monkeypatch.setenv("PRELEGAL_CHATS_PER_MINUTE", bad)
        assert create_app(db_path, static_dir).state.chat_limiter.limit == 20
