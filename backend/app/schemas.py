from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

# Bounds what one request can make us send to the (paid) model.
MAX_TEXT_CHARS = 4000
MAX_KEY_CHARS = 100  # field keys, party roles and document types
MAX_MESSAGES = 50
MAX_FIELD_VALUES = 100
MAX_PARTIES = 4


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)


class WireModel(BaseModel):
    """camelCase on the wire so the JSON maps directly onto the frontend's NdaFormData."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PartyFields(WireModel):
    company: str | None
    name: str | None = Field(description="Signatory name")
    title: str | None
    address: str | None = Field(description="Email or postal address for legal notices")


class NdaFields(WireModel):
    """Mutual NDA cover page fields. None means "not set" (in a request) or "unchanged" (in an update).

    Every property is required (no defaults) because strict JSON-schema Structured Outputs need that.
    """

    purpose: str | None
    effective_date: str | None = Field(description="ISO date, yyyy-mm-dd")
    term_type: Literal["expires", "continues"] | None
    term_years: int | None
    confidentiality_type: Literal["years", "perpetuity"] | None
    confidentiality_years: int | None
    governing_law: str | None = Field(description="US state, e.g. Delaware")
    jurisdiction: str | None = Field(description="City or county and state, e.g. New Castle, DE")
    modifications: str | None
    party1: PartyFields
    party2: PartyFields

    @field_validator("effective_date")
    @classmethod
    def _valid_iso_date(cls, value: str | None) -> str | None:
        # A model slip (e.g. "next Friday") is dropped rather than failing the whole turn.
        try:
            return date.fromisoformat(value).isoformat() if value else None
        except ValueError:
            return None

    @field_validator("term_years", "confidentiality_years")
    @classmethod
    def _positive_years(cls, value: int | None) -> int | None:
        return value if value is not None and value >= 1 else None


class ChatMessage(WireModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=MAX_TEXT_CHARS)


class FieldValue(WireModel):
    """A value for one field of a generic document (keys come from documents.DocumentSpec.fields)."""

    key: str
    value: str


class PartyDetails(PartyFields):
    """Details of one party of a generic document, by role (e.g. Provider, Customer)."""

    role: str


class ChatRequest(WireModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    fields: NdaFields
    # State of the generic (non-NDA) documents: the chosen document, and everything filled in so far.
    document_type: str | None = None
    values: list[FieldValue] = Field(default_factory=list, max_length=MAX_FIELD_VALUES)
    parties: list[PartyDetails] = Field(default_factory=list, max_length=MAX_PARTIES)

    @model_validator(mode="after")
    def _text_not_too_long(self) -> "ChatRequest":
        texts = [
            *_strings(self.fields.model_dump()),
            *(v.value for v in self.values),
            *(t for p in self.parties for t in _strings(p.model_dump())),
        ]
        if any(len(text) > MAX_TEXT_CHARS for text in texts):
            raise ValueError(f"field values must be at most {MAX_TEXT_CHARS} characters")
        names = [self.document_type or "", *(v.key for v in self.values), *(p.role for p in self.parties)]
        if any(len(name) > MAX_KEY_CHARS for name in names):
            raise ValueError(f"document types, field keys and party roles must be at most {MAX_KEY_CHARS} characters")
        return self

    @field_validator("messages")
    @classmethod
    def _ends_with_user_message(cls, messages: list[ChatMessage]) -> list[ChatMessage]:
        if messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return messages


class AiTurn(WireModel):
    """Structured output of one model call; also the /api/chat response body.

    Exactly one of `updates` (Mutual NDA) and `field_values` + `parties` (every other document) is used,
    depending on the active document; the others are null.
    """

    reply: str = Field(description="What to say to the user next")
    document_type: str | None = Field(
        description="Key of the document the user has chosen or switched to this turn; null if unchanged"
    )
    updates: NdaFields | None = Field(
        description="Mutual NDA only: the fields changed this turn, null for every other field"
    )
    field_values: list[FieldValue] | None = Field(
        description="Other documents only: the fields whose value the user gave this turn"
    )
    parties: list[PartyDetails] | None = Field(
        description="Other documents only: the party details the user gave this turn, null for unknown details"
    )
