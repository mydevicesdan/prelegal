from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import llm
from app.schemas import AiTurn, ChatMessage, ChatRequest, FieldValue, NdaFields, PartyDetails

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


def turn(reply="ok", *, document_type=None, updates=None, field_values=None, parties=None) -> AiTurn:
    return AiTurn(
        reply=reply,
        document_type=document_type,
        updates=NdaFields.model_validate(updates) if updates else None,
        field_values=field_values,
        parties=parties,
    )


def party(role, **details) -> PartyDetails:
    return PartyDetails(role=role, **{**EMPTY_PARTY, **details})


@pytest.fixture(autouse=True)
def api_key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")


@pytest.fixture
def client(user_client):
    """Chat needs a signed-in user."""
    return user_client


def returns(monkeypatch, result: AiTurn):
    """Makes the model answer with `result`, and records the request it was given."""
    seen = {}

    def fake_run_turn(request):
        seen["request"] = request
        return result

    monkeypatch.setattr(llm, "run_turn", fake_run_turn)
    return seen


class TestChatEndpoint:
    def test_returns_the_reply_and_nda_updates_in_camel_case(self, client: TestClient, monkeypatch):
        seen = returns(
            monkeypatch,
            turn(
                "Got it, who is the other party?",
                document_type="mutual-nda",
                updates=fields(governingLaw="Delaware", party1={**EMPTY_PARTY, "company": "Acme"}, termYears=2),
            ),
        )
        response = client.post(
            "/api/chat",
            json=request_body(
                messages=[
                    {"role": "assistant", "content": "Hello!"},
                    {"role": "user", "content": "Acme, Delaware law"},
                ]
            ),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["reply"] == "Got it, who is the other party?"
        assert body["documentType"] == "mutual-nda"
        assert body["updates"]["governingLaw"] == "Delaware"
        assert body["updates"]["termYears"] == 2
        assert body["updates"]["party1"]["company"] == "Acme"
        assert body["updates"]["party2"] == EMPTY_PARTY
        assert [m.role for m in seen["request"].messages] == ["assistant", "user"]
        assert seen["request"].fields.purpose.startswith("Evaluating")

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
            request_body(values=[{"key": "governing-law", "value": "x" * 4001}]),
            request_body(values=[{"key": f"k{i}", "value": "v"} for i in range(101)]),
            request_body(parties=[{"role": "Provider", **EMPTY_PARTY, "company": "x" * 4001}]),
            request_body(parties=[{"role": f"r{i}", **EMPTY_PARTY} for i in range(5)]),
        ],
    )
    def test_invalid_requests_are_rejected(self, client: TestClient, monkeypatch, body):
        monkeypatch.setattr(llm, "run_turn", lambda *_: pytest.fail("LLM must not be called"))
        assert client.post("/api/chat", json=body).status_code == 422

    def test_a_request_without_document_state_is_still_valid(self, client: TestClient, monkeypatch):
        seen = returns(monkeypatch, turn("hello"))
        assert client.post("/api/chat", json=request_body()).status_code == 200
        request = seen["request"]
        assert (request.document_type, request.values, request.parties) == (None, [], [])


class TestDocumentChoice:
    def test_choosing_a_document_is_reported(self, client: TestClient, monkeypatch):
        returns(monkeypatch, turn("A CSA it is.", document_type="csa", field_values=[], parties=[]))
        body = client.post("/api/chat", json=request_body()).json()
        assert body["documentType"] == "csa"

    def test_an_unknown_document_type_is_dropped(self, client: TestClient, monkeypatch):
        returns(monkeypatch, turn("Sure.", document_type="employment-agreement"))
        body = client.post("/api/chat", json=request_body()).json()
        assert body["documentType"] is None
        assert body["fieldValues"] is None and body["updates"] is None

    def test_no_document_means_no_field_updates(self, client: TestClient, monkeypatch):
        returns(
            monkeypatch,
            turn(
                "hi",
                updates=fields(governingLaw="Ohio"),
                field_values=[FieldValue(key="governing-law", value="Ohio")],
                parties=[party("Provider", company="Acme")],
            ),
        )
        body = client.post("/api/chat", json=request_body()).json()
        assert (body["updates"], body["fieldValues"], body["parties"]) == (None, None, None)

    def test_generic_updates_keep_only_known_keys_and_roles(self, client: TestClient, monkeypatch):
        returns(
            monkeypatch,
            turn(
                "Recorded.",
                field_values=[
                    FieldValue(key="governing-law", value="Delaware"),
                    FieldValue(key="not-a-field", value="x"),
                    FieldValue(key="target-uptime", value="99.9%"),  # an SLA field, not a CSA one
                ],
                parties=[party("Provider", company="Acme"), party("Partner", company="Nope")],
                updates=fields(governingLaw="Ohio"),
            ),
        )
        body = client.post("/api/chat", json=request_body(documentType="csa")).json()
        assert body["fieldValues"] == [{"key": "governing-law", "value": "Delaware"}]
        assert [p["role"] for p in body["parties"]] == ["Provider"]
        assert body["updates"] is None  # NDA updates make no sense for a CSA

    def test_switching_documents_validates_against_the_new_one(self, client: TestClient, monkeypatch):
        returns(
            monkeypatch,
            turn(
                "Switching.",
                document_type="sla",
                field_values=[FieldValue(key="target-uptime", value="99.9%"), FieldValue(key="governing-law", value="x")],
            ),
        )
        body = client.post("/api/chat", json=request_body(documentType="csa")).json()
        assert body["documentType"] == "sla"
        assert body["fieldValues"] == [{"key": "target-uptime", "value": "99.9%"}]

    def test_nda_updates_are_kept_while_the_nda_is_active(self, client: TestClient, monkeypatch):
        returns(
            monkeypatch,
            turn("ok", updates=fields(governingLaw="Ohio"), field_values=[FieldValue(key="governing-law", value="x")]),
        )
        body = client.post("/api/chat", json=request_body(documentType="mutual-nda")).json()
        assert body["updates"]["governingLaw"] == "Ohio"
        assert body["fieldValues"] is None and body["parties"] is None


class TestDocumentChoiceRerun:
    """Details in the message that picks the document can only be recorded once the model knows the document."""

    def scripted(self, monkeypatch, *turns: AiTurn):
        requests = []
        queue = list(turns)

        def fake_run_turn(request):
            requests.append(request)
            return queue.pop(0)

        monkeypatch.setattr(llm, "run_turn", fake_run_turn)
        return requests

    def test_choosing_a_document_asks_the_model_again_with_the_document_set(self, client: TestClient, monkeypatch):
        requests = self.scripted(
            monkeypatch,
            turn("Got it, a CSA.", document_type="csa"),
            turn(
                "Recorded Acme and Delaware.",
                document_type="csa",
                field_values=[FieldValue(key="governing-law", value="Delaware")],
                parties=[party("Provider", company="Acme")],
            ),
        )
        body = client.post("/api/chat", json=request_body()).json()

        assert [r.document_type for r in requests] == [None, "csa"]
        assert body["reply"] == "Recorded Acme and Delaware."
        assert body["documentType"] == "csa"
        assert body["fieldValues"] == [{"key": "governing-law", "value": "Delaware"}]
        assert [p["company"] for p in body["parties"]] == ["Acme"]

    def test_the_document_stays_chosen_even_if_the_second_answer_forgets_to_say_so(self, client: TestClient, monkeypatch):
        self.scripted(monkeypatch, turn("A CSA.", document_type="csa"), turn("Who are the parties?", document_type=None))
        body = client.post("/api/chat", json=request_body()).json()
        assert body["documentType"] == "csa" and body["reply"] == "Who are the parties?"

    def test_switching_to_another_document_asks_again_for_that_one(self, client: TestClient, monkeypatch):
        requests = self.scripted(
            monkeypatch,
            turn("Switching.", document_type="sla"),
            turn("SLA it is.", document_type=None, field_values=[FieldValue(key="target-uptime", value="99.9%")]),
        )
        body = client.post("/api/chat", json=request_body(documentType="csa")).json()
        assert [r.document_type for r in requests] == ["csa", "sla"]
        assert body["documentType"] == "sla"
        assert body["fieldValues"] == [{"key": "target-uptime", "value": "99.9%"}]

    def test_no_second_call_when_the_document_does_not_change(self, client: TestClient, monkeypatch):
        requests = self.scripted(monkeypatch, turn("More.", document_type=None), turn("Same.", document_type="csa"))
        client.post("/api/chat", json=request_body(documentType="csa"))
        client.post("/api/chat", json=request_body(documentType="csa"))
        assert len(requests) == 2  # one call per request

    def test_no_second_call_for_an_unknown_document(self, client: TestClient, monkeypatch):
        requests = self.scripted(monkeypatch, turn("Sure.", document_type="employment-agreement"))
        assert client.post("/api/chat", json=request_body()).json()["documentType"] is None
        assert len(requests) == 1

    def test_a_failing_second_call_is_a_502(self, client: TestClient, monkeypatch):
        calls = []

        def flaky(request):
            calls.append(request)
            if len(calls) == 2:
                raise RuntimeError("upstream detail")
            return turn("A CSA.", document_type="csa")

        monkeypatch.setattr(llm, "run_turn", flaky)
        response = client.post("/api/chat", json=request_body())
        assert response.status_code == 502 and "upstream" not in response.text


class TestChatAccess:
    def test_needs_a_signed_in_user(self, app, monkeypatch):
        monkeypatch.setattr(llm, "run_turn", lambda *_: pytest.fail("LLM must not be called"))
        with TestClient(app) as anonymous:
            assert anonymous.post("/api/chat", json=request_body()).status_code == 401

    def test_is_rate_limited_per_user(self, client: TestClient, other_client: TestClient, monkeypatch):
        calls = []
        monkeypatch.setattr(llm, "run_turn", lambda request: calls.append(request) or turn("ok"))
        assert [client.post("/api/chat", json=request_body()).status_code for _ in range(20)] == [200] * 20
        limited = client.post("/api/chat", json=request_body())
        assert limited.status_code == 429 and "too quickly" in limited.json()["detail"]
        assert len(calls) == 20  # the refused message never reached the model
        # Another user is not affected.
        assert other_client.post("/api/chat", json=request_body()).status_code == 200

    @pytest.mark.parametrize(
        "body",
        [
            request_body(documentType="x" * 101),
            request_body(values=[{"key": "k" * 101, "value": "v"}]),
            request_body(parties=[{"role": "r" * 101, **EMPTY_PARTY}]),
        ],
    )
    def test_keys_roles_and_document_types_are_capped(self, client: TestClient, monkeypatch, body):
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
    def call(self, monkeypatch, request: ChatRequest, result: AiTurn | None = None):
        captured = {}
        result = result or turn("Hello")

        def fake_completion(**kwargs):
            captured.update(kwargs)
            content = result.model_dump_json(by_alias=True)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

        monkeypatch.setattr(llm, "completion", fake_completion)
        return llm.run_turn(request), captured

    def test_calls_cerebras_with_structured_output(self, monkeypatch):
        request = ChatRequest.model_validate(request_body(messages=[{"role": "user", "content": "Ohio please"}]))
        result, captured = self.call(monkeypatch, request, turn("Hello", updates=fields(governingLaw="Ohio")))

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
        assert user == {"role": "user", "content": "Ohio please"}

    def test_prompt_lists_every_document_and_says_what_to_do_with_unsupported_requests(self, monkeypatch):
        _, captured = self.call(monkeypatch, ChatRequest.model_validate(request_body()))
        system = captured["messages"][0]["content"]
        for key in ("mutual-nda", "csa", "sla", "dpa", "design-partner-agreement", "psa",
                    "partnership-agreement", "baa", "software-license-agreement", "pilot-agreement", "ai-addendum"):
            assert f"- {key}:" in system
        assert "cannot generate that" in system and "closest document" in system
        assert "No document has been chosen yet" in system
        assert "plain text, never markdown" in system  # the chat shows replies as literal text

    def test_nda_prompt_includes_the_current_nda_fields(self, monkeypatch):
        request = ChatRequest.model_validate(request_body(documentType="mutual-nda", fields=fields(purpose="Testing")))
        _, captured = self.call(monkeypatch, request)
        system = captured["messages"][0]["content"]
        assert "The active document is the Mutual Non-Disclosure Agreement" in system
        assert '"purpose": "Testing"' in system

    def test_generic_prompt_lists_fields_roles_and_current_values(self, monkeypatch):
        request = ChatRequest.model_validate(
            request_body(
                documentType="csa",
                values=[{"key": "governing-law", "value": "Delaware"}, {"key": "target-uptime", "value": "99.9%"}],
                parties=[{"role": "Provider", **EMPTY_PARTY, "company": "Acme Inc"}],
            )
        )
        _, captured = self.call(monkeypatch, request)
        system = captured["messages"][0]["content"]
        assert "Cloud Service Agreement" in system and "`csa`" in system
        assert "exactly one of: Customer, Provider" in system
        assert "- governing-law: Governing Law (Key Terms)." in system
        assert "Current value: Delaware" in system
        assert "- Provider: company=Acme Inc" in system
        # A value from another document is offered for reuse rather than listed as a field of this one.
        assert "Other details already known" in system and "- target-uptime: 99.9%" in system

    def test_prompt_offers_known_nda_details_to_a_new_document(self, monkeypatch):
        request = ChatRequest.model_validate(
            request_body(documentType="csa", fields=fields(governingLaw="Ohio", party1={**EMPTY_PARTY, "company": "Acme"}))
        )
        _, captured = self.call(monkeypatch, request)
        system = captured["messages"][0]["content"]
        assert "from a Mutual NDA in progress" in system
        assert "- governingLaw: Ohio" in system and "- party1: Acme" in system


def test_chat_messages_are_validated_models():
    assert ChatMessage(role="user", content="hi").content == "hi"
