import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.db import now_iso
from tests.conftest import USER, sign_up

COOKIE = auth.SESSION_COOKIE


def signed_in(client: TestClient) -> bool:
    response = client.get("/api/auth/session")
    assert response.status_code == 200
    return response.json()["user"] is not None


def login(client: TestClient, **overrides):
    return client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"], **overrides})


class TestSignup:
    def test_creates_the_account_and_signs_the_user_in(self, client: TestClient):
        response = client.post("/api/auth/signup", json=USER)
        assert response.status_code == 201
        assert response.json() == {"id": 1, "name": "Ada Lovelace", "email": "ada@example.com"}
        assert client.get("/api/auth/session").json() == {"user": {"id": 1, "name": "Ada Lovelace", "email": "ada@example.com"}}

    def test_never_returns_or_stores_the_password(self, client: TestClient, db_path: Path):
        response = client.post("/api/auth/signup", json=USER)
        assert USER["password"] not in response.text and "passwordHash" not in response.text
        with sqlite3.connect(db_path) as conn:
            (stored,) = conn.execute("SELECT password_hash FROM users").fetchone()
        assert stored.startswith("$argon2") and USER["password"] not in stored

    def test_the_cookie_is_http_only_and_lax(self, client: TestClient):
        header = client.post("/api/auth/signup", json=USER).headers["set-cookie"].lower()
        assert f"{COOKIE}=" in header
        assert "httponly" in header and "samesite=lax" in header and "path=/" in header
        assert "max-age=2592000" in header  # 30 days
        assert "secure" not in header  # served over plain http here

    def test_the_cookie_is_secure_over_https(self, app):
        with TestClient(app, base_url="https://testserver") as https:
            header = https.post("/api/auth/signup", json=USER).headers["set-cookie"].lower()
        assert "secure" in header

    def test_only_a_hash_of_the_session_token_is_stored(self, client: TestClient, db_path: Path):
        client.post("/api/auth/signup", json=USER)
        token = client.cookies.get(COOKIE)
        with sqlite3.connect(db_path) as conn:
            (stored,) = conn.execute("SELECT token_hash FROM sessions").fetchone()
        assert token and stored != token and len(stored) == 64

    def test_email_is_case_insensitive_and_trimmed(self, client: TestClient):
        assert sign_up(client, email="  Ada@Example.COM ")["email"] == "ada@example.com"
        assert client.post("/api/auth/signup", json={**USER, "email": "ADA@example.com"}).status_code == 409

    def test_a_duplicate_email_is_a_409(self, client: TestClient):
        sign_up(client)
        response = client.post("/api/auth/signup", json={**USER, "name": "Someone Else"})
        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]

    def test_the_name_is_tidied(self, client: TestClient):
        assert sign_up(client, name="  Ada   Lovelace  ")["name"] == "Ada Lovelace"

    @pytest.mark.parametrize(
        "overrides",
        [
            {"name": ""},
            {"name": "   "},
            {"name": "x" * 101},
            {"email": ""},
            {"email": "not-an-email"},
            {"email": "a@b"},
            {"email": "a b@example.com"},
            {"email": "x" * 250 + "@example.com"},
            {"password": "short"},
            {"password": "x" * 129},
        ],
    )
    def test_invalid_details_are_rejected(self, client: TestClient, overrides):
        assert client.post("/api/auth/signup", json={**USER, **overrides}).status_code == 422

    def test_missing_fields_are_rejected(self, client: TestClient):
        assert client.post("/api/auth/signup", json={"email": USER["email"]}).status_code == 422

    def test_sign_ups_are_rate_limited_per_address(self, client: TestClient):
        for i in range(20):
            assert client.post("/api/auth/signup", json={**USER, "email": f"u{i}@example.com"}).status_code == 201
        assert client.post("/api/auth/signup", json={**USER, "email": "one-more@example.com"}).status_code == 429


class TestLogin:
    def test_signs_in_with_the_right_password(self, client: TestClient):
        sign_up(client)
        client.cookies.clear()
        assert not signed_in(client)

        response = login(client)
        assert response.status_code == 200
        assert response.json()["name"] == "Ada Lovelace"
        assert signed_in(client)

    def test_email_matching_ignores_case(self, client: TestClient):
        sign_up(client)
        client.cookies.clear()
        assert login(client, email="ADA@EXAMPLE.COM").status_code == 200

    def test_wrong_password_and_unknown_email_get_the_same_answer(self, client: TestClient):
        sign_up(client)
        client.cookies.clear()
        wrong_password = login(client, password="not the password")
        unknown_email = login(client, email="nobody@example.com")
        assert wrong_password.status_code == unknown_email.status_code == 401
        assert wrong_password.json() == unknown_email.json() == {"detail": "Incorrect email or password."}
        assert COOKIE not in client.cookies

    def test_repeated_failures_are_blocked_even_for_the_right_password(self, client: TestClient):
        sign_up(client)
        client.cookies.clear()
        for _ in range(10):
            assert login(client, password="wrong").status_code == 401
        assert login(client, password="wrong").status_code == 429
        assert login(client).status_code == 429  # the correct password is refused too while blocked

    def test_failures_for_one_email_do_not_block_another(self, client: TestClient):
        sign_up(client)
        sign_up(client, name="Grace", email="grace@example.com")
        client.cookies.clear()
        for _ in range(10):
            login(client, password="wrong")
        assert client.post("/api/auth/login", json={"email": "grace@example.com", "password": USER["password"]}).status_code == 200

    def test_one_address_cannot_spray_guesses_across_many_accounts(self, app, client: TestClient):
        app.state.login_ip_limiter.limit = 5
        for n in range(5):
            assert login(client, email=f"nobody{n}@example.com", password="wrong").status_code == 401
        assert login(client, email="someone.else@example.com", password="wrong").status_code == 429

    def test_parallel_guesses_cannot_slip_past_the_account_limit(self, app, client: TestClient):
        # Attempts are counted before the (slow) password check, not after it.
        sign_up(client)
        client.cookies.clear()
        assert all(app.state.login_limiter.allow(f"testclient|{USER['email']}") for _ in range(10))
        assert login(client).status_code == 429

    def test_a_successful_login_clears_the_failure_count(self, client: TestClient):
        sign_up(client)
        client.cookies.clear()
        for _ in range(9):
            login(client, password="wrong")
        assert login(client).status_code == 200
        for _ in range(9):
            assert login(client, password="wrong").status_code == 401

    def test_expired_sessions_are_cleaned_up_on_login(self, client: TestClient, db_path: Path):
        sign_up(client)
        with sqlite3.connect(db_path) as conn:
            conn.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000000Z'")
        client.cookies.clear()
        login(client)
        with sqlite3.connect(db_path) as conn:
            assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone() == (1,)

    def test_several_browsers_can_be_signed_in_at_once(self, app):
        with TestClient(app) as first, TestClient(app) as second:
            sign_up(first)
            assert login(second).status_code == 200
            assert signed_in(first)
            assert signed_in(second)


class TestSessions:
    def test_nobody_is_signed_in_by_default_and_that_is_not_an_error(self, client: TestClient):
        response = client.get("/api/auth/session")
        assert response.status_code == 200
        assert response.json() == {"user": None}

    def test_a_garbage_cookie_is_not_a_session(self, client: TestClient):
        client.cookies.set(COOKIE, "definitely-not-a-token")
        assert not signed_in(client)

    def test_an_expired_session_is_refused(self, user_client: TestClient, db_path: Path):
        with sqlite3.connect(db_path) as conn:
            conn.execute("UPDATE sessions SET expires_at = ?", ("2000-01-01T00:00:00.000000Z",))
        assert not signed_in(user_client)

    def test_logout_ends_the_session_everywhere_it_was_used(self, user_client: TestClient):
        token = user_client.cookies.get(COOKIE)
        response = user_client.post("/api/auth/logout")
        assert response.status_code == 204
        assert COOKIE in response.headers["set-cookie"] and "max-age=0" in response.headers["set-cookie"].lower()
        # The cookie is gone from the browser, and the server no longer honours the old token either.
        assert not signed_in(user_client)
        user_client.cookies.set(COOKIE, token)
        assert not signed_in(user_client)

    def test_logout_without_a_session_is_harmless(self, client: TestClient):
        assert client.post("/api/auth/logout").status_code == 204

    def test_logging_out_one_browser_leaves_the_other_signed_in(self, app):
        with TestClient(app) as first, TestClient(app) as second:
            sign_up(first)
            login(second)
            first.post("/api/auth/logout")
            assert signed_in(second)

    def test_deleting_a_user_removes_their_sessions(self, user_client: TestClient, db_path: Path):
        with sqlite3.connect(db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("DELETE FROM users")
            assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone() == (0,)


class TestProtectedEndpoints:
    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("get", "/api/documents/csa"),
            ("post", "/api/chat"),
            ("get", "/api/drafts"),
            ("post", "/api/drafts"),
            ("get", "/api/drafts/1"),
            ("put", "/api/drafts/1"),
            ("delete", "/api/drafts/1"),
        ],
    )
    def test_they_need_a_session(self, client: TestClient, method, path):
        assert getattr(client, method)(path).status_code == 401

    def test_health_and_the_frontend_stay_public(self, client: TestClient):
        assert client.get("/api/health").status_code == 200
        assert client.get("/").status_code == 200


class TestPasswordHelpers:
    def test_verifies_only_the_right_password(self):
        hashed = auth.hash_password("s3cret-passphrase")
        assert auth.verify_password(hashed, "s3cret-passphrase")
        assert not auth.verify_password(hashed, "S3cret-passphrase")

    def test_the_same_password_hashes_differently_each_time(self):
        assert auth.hash_password("same") != auth.hash_password("same")

    def test_a_malformed_hash_is_just_a_failed_check(self):
        assert not auth.verify_password("not-a-hash", "anything")

    def test_timestamps_sort_as_strings(self):
        first, second = now_iso(), now_iso()
        assert first <= second and first.endswith("Z")
