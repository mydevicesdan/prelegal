from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

# Bounds what one request can make us send to the (paid) model.
MAX_TEXT_CHARS = 4000
MAX_MESSAGES = 50


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
    name: str | None
    title: str | None
    address: str | None


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


class ChatRequest(WireModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    fields: NdaFields

    @field_validator("fields")
    @classmethod
    def _fields_not_too_long(cls, fields: NdaFields) -> NdaFields:
        if any(len(text) > MAX_TEXT_CHARS for text in _strings(fields.model_dump())):
            raise ValueError(f"field values must be at most {MAX_TEXT_CHARS} characters")
        return fields

    @field_validator("messages")
    @classmethod
    def _ends_with_user_message(cls, messages: list[ChatMessage]) -> list[ChatMessage]:
        if messages[-1].role != "user":
            raise ValueError("the last message must be from the user")
        return messages


class AiTurn(WireModel):
    """Structured output of one model call; also the /api/chat response body."""

    reply: str = Field(description="What to say to the user next")
    updates: NdaFields = Field(description="Only the fields changed this turn; null for everything else")
