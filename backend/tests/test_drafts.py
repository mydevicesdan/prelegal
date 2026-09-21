import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import drafts_api

STATE = {
    "documentType": "csa",
    "nda": {"purpose": "x"},
    "values": {"governing-law": "Delaware"},
    "parties": {"Provider": {"company": "Acme Inc", "name": "", "title": "", "address": ""}},
}
MESSAGES = [
    {"role": "assistant", "content": "Hello!"},
    {"role": "user", "content": "A cloud service agreement, please."},
]


def draft(**overrides) -> dict:
    return {"documentType": "csa", "companies": ["Acme Inc", "Globex LLC"], "state": STATE, "messages": MESSAGES, **overrides}


def create(client: TestClient, **overrides) -> dict:
    response = client.post("/api/drafts", json=draft(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


class TestCreateAndRead:
    def test_saves_a_draft_and_returns_it_whole(self, user_client: TestClient):
        created = create(user_client)
        assert created["documentType"] == "csa"
        assert created["documentName"] == "Cloud Service Agreement"
        assert created["companies"] == ["Acme Inc", "Globex LLC"]
        assert created["state"] == STATE and created["messages"] == MESSAGES
        assert created["createdAt"] == created["updatedAt"]

    def test_reads_back_exactly_what_was_saved(self, user_client: TestClient):
        created = create(user_client)
        assert user_client.get(f"/api/drafts/{created['id']}").json() == created

    def test_the_nda_can_be_saved_too(self, user_client: TestClient):
        assert create(user_client, documentType="mutual-nda")["documentName"] == "Mutual Non-Disclosure Agreement"

    def test_blank_companies_are_dropped(self, user_client: TestClient):
        assert create(user_client, companies=["  Acme  ", "", "   "])["companies"] == ["Acme"]

    def test_unicode_and_markup_survive_unchanged(self, user_client: TestClient):
        state = {"values": {"purpose": "<b>Café</b> **x** ’"}}
        created = create(user_client, state=state)
        assert user_client.get(f"/api/drafts/{created['id']}").json()["state"] == state

    def test_a_missing_draft_is_a_404(self, user_client: TestClient):
        assert user_client.get("/api/drafts/999").status_code == 404

    @pytest.mark.parametrize("draft_id", ["0", "-1", str(2**63), "99999999999999999999"])
    def test_an_id_the_database_cannot_hold_is_a_404_not_an_error(self, user_client: TestClient, draft_id: str):
        assert user_client.get(f"/api/drafts/{draft_id}").status_code == 404
        assert user_client.put(f"/api/drafts/{draft_id}", json=draft()).status_code == 404
        assert user_client.delete(f"/api/drafts/{draft_id}").status_code == 404

    @pytest.mark.parametrize(
        "overrides",
        [
            {"documentType": "employment-agreement"},
            {"documentType": ""},
            {"documentType": "x" * 101},
            {"companies": ["a", "b", "c", "d", "e"]},
            {"companies": ["x" * 201]},
            {"state": "not an object"},
            {"state": {"blob": "x" * 200_001}},
            {"messages": [{"role": "system", "content": "hi"}]},
            {"messages": [{"role": "user", "content": "x" * 4001}]},
            {"messages": [{"role": "user", "content": "hi"}] * 201},
        ],
    )
    def test_invalid_drafts_are_rejected(self, user_client: TestClient, overrides):
        assert user_client.post("/api/drafts", json=draft(**overrides)).status_code == 422

    def test_a_missing_field_is_rejected(self, user_client: TestClient):
        assert user_client.post("/api/drafts", json={"documentType": "csa"}).status_code == 422

    def test_a_full_length_conversation_is_accepted(self, user_client: TestClient):
        messages = [{"role": "user" if i % 2 else "assistant", "content": "x" * 4000} for i in range(200)]
        assert user_client.post("/api/drafts", json=draft(messages=messages)).status_code == 201

    def test_there_is_a_limit_per_user(self, user_client: TestClient, monkeypatch):
        monkeypatch.setattr(drafts_api, "MAX_DRAFTS_PER_USER", 2)
        create(user_client)
        create(user_client)
        response = user_client.post("/api/drafts", json=draft())
        assert response.status_code == 409 and "limit of 2" in response.json()["detail"]

    def test_the_limit_is_per_user(self, user_client: TestClient, other_client: TestClient, monkeypatch):
        monkeypatch.setattr(drafts_api, "MAX_DRAFTS_PER_USER", 1)
        create(user_client)
        assert other_client.post("/api/drafts", json=draft()).status_code == 201


class TestList:
    def test_starts_empty(self, user_client: TestClient):
        assert user_client.get("/api/drafts").json() == []

    def test_lists_summaries_most_recently_saved_first(self, user_client: TestClient):
        first = create(user_client, documentType="csa")
        second = create(user_client, documentType="dpa")
        user_client.put(f"/api/drafts/{first['id']}", json=draft(documentType="csa"))  # saving moves it to the top

        listed = user_client.get("/api/drafts").json()
        assert [d["id"] for d in listed] == [first["id"], second["id"]]
        assert set(listed[0]) == {"id", "documentType", "documentName", "companies", "createdAt", "updatedAt"}
        assert listed[1]["documentName"] == "Data Processing Agreement"

    def test_summaries_do_not_carry_the_conversation(self, user_client: TestClient):
        create(user_client)
        assert "messages" not in user_client.get("/api/drafts").json()[0]
        assert "state" not in user_client.get("/api/drafts").json()[0]


class TestUpdate:
    def test_saving_replaces_the_contents_and_bumps_the_time(self, user_client: TestClient):
        created = create(user_client)
        newer = {"values": {"governing-law": "Ohio"}}
        response = user_client.put(
            f"/api/drafts/{created['id']}",
            json=draft(companies=["Acme Inc"], state=newer, messages=MESSAGES[:1]),
        )
        assert response.status_code == 200
        saved = response.json()
        assert saved["state"] == newer and saved["messages"] == MESSAGES[:1] and saved["companies"] == ["Acme Inc"]
        assert saved["createdAt"] == created["createdAt"] and saved["updatedAt"] > created["updatedAt"]
        assert user_client.get(f"/api/drafts/{created['id']}").json() == saved

    def test_saving_a_missing_draft_is_a_404(self, user_client: TestClient):
        assert user_client.put("/api/drafts/999", json=draft()).status_code == 404

    def test_an_invalid_save_leaves_the_draft_untouched(self, user_client: TestClient):
        created = create(user_client)
        assert user_client.put(f"/api/drafts/{created['id']}", json=draft(documentType="nope")).status_code == 422
        assert user_client.get(f"/api/drafts/{created['id']}").json() == created


class TestDelete:
    def test_deletes_the_draft(self, user_client: TestClient):
        created = create(user_client)
        assert user_client.delete(f"/api/drafts/{created['id']}").status_code == 204
        assert user_client.get(f"/api/drafts/{created['id']}").status_code == 404
        assert user_client.get("/api/drafts").json() == []

    def test_deleting_a_missing_draft_is_a_404(self, user_client: TestClient):
        assert user_client.delete("/api/drafts/999").status_code == 404


class TestIsolationBetweenUsers:
    """One user must never see, change or delete another's documents."""

    def test_lists_only_your_own(self, user_client: TestClient, other_client: TestClient):
        mine = create(user_client)
        theirs = create(other_client, documentType="dpa")
        assert [d["id"] for d in user_client.get("/api/drafts").json()] == [mine["id"]]
        assert [d["id"] for d in other_client.get("/api/drafts").json()] == [theirs["id"]]

    def test_someone_elses_draft_looks_like_it_does_not_exist(self, user_client: TestClient, other_client: TestClient):
        theirs = create(other_client)
        assert user_client.get(f"/api/drafts/{theirs['id']}").status_code == 404
        assert user_client.put(f"/api/drafts/{theirs['id']}", json=draft(companies=["Hijack"])).status_code == 404
        assert user_client.delete(f"/api/drafts/{theirs['id']}").status_code == 404
        # ...and it is untouched.
        assert other_client.get(f"/api/drafts/{theirs['id']}").json() == theirs

    def test_drafts_survive_signing_out_and_back_in(self, user_client: TestClient):
        created = create(user_client)
        user_client.post("/api/auth/logout")
        assert user_client.get("/api/drafts").status_code == 401
        user_client.post("/api/auth/login", json={"email": "ada@example.com", "password": "correct horse battery"})
        assert user_client.get(f"/api/drafts/{created['id']}").json() == created

    def test_deleting_an_account_deletes_its_drafts(self, user_client: TestClient, db_path: Path):
        create(user_client)
        with sqlite3.connect(db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("DELETE FROM users")
            assert conn.execute("SELECT COUNT(*) FROM documents").fetchone() == (0,)

    def test_a_restart_clears_everything(self, user_client: TestClient, db_path: Path, static_dir: Path):
        create(user_client)
        from app.main import create_app

        with TestClient(create_app(db_path, static_dir)) as fresh:
            assert fresh.get("/api/auth/session").json() == {"user": None}  # sessions are gone too
        with sqlite3.connect(db_path) as conn:
            assert conn.execute("SELECT COUNT(*) FROM documents").fetchone() == (0,)


def test_stored_values_are_json(user_client: TestClient, db_path: Path):
    create(user_client)
    with sqlite3.connect(db_path) as conn:
        state, messages, companies = conn.execute("SELECT state, messages, companies FROM documents").fetchone()
    assert json.loads(state) == STATE and json.loads(messages) == MESSAGES and json.loads(companies) == ["Acme Inc", "Globex LLC"]
