from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import llm
from app.schemas import AiTurn, ChatMessage, NdaFields

EMPTY_PARTY = {"company": None, "name": None, "title": None, "address": None}


def fields(**overrides) -> dict:
    base = {
        "purpose": "Evaluating whether to enter into a business relationship with the other party.",
        "effectiveDate": None,
        "termType": "expires",
        "termYears": 1,
        "confidentialityType": "years",
        "confidentialityYears": 1,
        "governingLaw": None,
        "jurisdiction": None,
        "modifications": None,
        "party1": EMPTY_PARTY,
        "party2": EMPTY_PARTY,
    }
    return {**base, **overrides}


def request_body(**overrides) -> dict:
    body = {"messages": [{"role": "user", "content": "Hi"}], "fields": fields()}
    return {**body, **overrides}


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")


class TestChatEndpoint:
    def test_returns_reply_and_updates_in_camel_case(self, client: TestClient, monkeypatch):
        seen = {}

        def fake_run_turn(messages, current):
            seen["messages"], seen["fields"] = messages, current
            return AiTurn(
                reply="Got it, who is the other party?",
                updates=NdaFields.model_validate(
                    fields(governingLaw="Delaware", party1={**EMPTY_PARTY, "company": "Acme"}, termYears=2)
                ),
            )

        monkeypatch.setattr(llm, "run_turn", fake_run_turn)
        response = client.post("/api/chat", json=request_body(messages=[
            {"role": "assistant", "content": "Hello!"},
            {"role": "user", "content": "Acme, Delaware law"},
        ]))

        assert response.status_code == 200
        body = response.json()
        assert body["reply"] == "Got it, who is the other party?"
        assert body["updates"]["governingLaw"] == "Delaware"
        assert body["updates"]["termYears"] == 2
        assert body["updates"]["party1"]["company"] == "Acme"
        assert body["updates"]["party2"] == EMPTY_PARTY
        assert [m.role for m in seen["messages"]] == ["assistant", "user"]
        assert seen["fields"].purpose.startswith("Evaluating")

    def test_missing_api_key_is_a_503(self, client: TestClient, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY")
        response = client.post("/api/chat", json=request_body())
        assert response.status_code == 503
        assert "OPENROUTER_API_KEY" in response.json()["detail"]

    def test_llm_failure_is_a_502_without_leaking_details(self, client: TestClient, monkeypatch):
        def boom(*_):
            raise RuntimeError("secret upstream detail")

        monkeypatch.setattr(llm, "run_turn", boom)
        response = client.post("/api/chat", json=request_body())
        assert response.status_code == 502
        assert "secret" not in response.text

    @pytest.mark.parametrize(
        "body",
        [
            request_body(messages=[]),
            request_body(messages=[{"role": "assistant", "content": "Hello"}]),
            request_body(messages=[{"role": "system", "content": "x"}]),
            request_body(messages=[{"role": "user", "content": "x" * 4001}]),
            request_body(messages=[{"role": "user", "content": "x"}] * 51),
            {"messages": [{"role": "user", "content": "Hi"}]},
            request_body(fields=fields(termType="sometimes")),
            request_body(fields=fields(purpose="x" * 4001)),
            request_body(fields=fields(party1={**EMPTY_PARTY, "company": "x" * 4001})),
        ],
    )
    def test_invalid_requests_are_rejected(self, client: TestClient, monkeypatch, body):
        monkeypatch.setattr(llm, "run_turn", lambda *_: pytest.fail("LLM must not be called"))
        assert client.post("/api/chat", json=body).status_code == 422


class TestFieldSanitising:
    def test_invalid_date_is_dropped(self):
        assert NdaFields.model_validate(fields(effectiveDate="next Friday")).effective_date is None
        assert NdaFields.model_validate(fields(effectiveDate="2026-02-30")).effective_date is None

    def test_valid_date_is_kept(self):
        assert NdaFields.model_validate(fields(effectiveDate="2027-01-05")).effective_date == "2027-01-05"

    @pytest.mark.parametrize("years", [0, -3])
    def test_non_positive_years_are_dropped(self, years):
        parsed = NdaFields.model_validate(fields(termYears=years, confidentialityYears=years))
        assert parsed.term_years is None and parsed.confidentiality_years is None


class TestRunTurn:
    def test_calls_cerebras_with_structured_output_and_todays_date(self, monkeypatch):
        captured = {}
        turn = AiTurn(reply="Hello", updates=NdaFields.model_validate(fields(governingLaw="Ohio")))

        def fake_completion(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=turn.model_dump_json(by_alias=True)))])

        monkeypatch.setattr(llm, "completion", fake_completion)
        result = llm.run_turn(
            [ChatMessage(role="user", content="Ohio please")],
            NdaFields.model_validate(fields(purpose="Testing")),
        )

        assert result.updates.governing_law == "Ohio"
        assert captured["model"] == "openrouter/openai/gpt-oss-120b"
        assert captured["response_format"] is AiTurn
        assert captured["extra_body"] == {"provider": {"order": ["cerebras"], "allow_fallbacks": False}}
        assert captured["reasoning_effort"] == "low"
        assert captured["timeout"] == 30
        assert captured["max_tokens"] == 4000
        system, user = captured["messages"]
        assert system["role"] == "system"
        assert date.today().isoformat() in system["content"]
        assert '"purpose": "Testing"' in system["content"]
        assert user == {"role": "user", "content": "Ohio please"}
