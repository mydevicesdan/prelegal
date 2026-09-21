"""Saved drafts: the documents a user has created, with everything needed to reopen and keep editing them.

The frontend owns the shape of `state` (it is the editor's state), so the backend stores it as opaque JSON,
bounded in size, and scopes every query to the signed-in user.
"""

import json
import sqlite3
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import Field, field_validator, model_validator

from app.db import now_iso
from app.deps import current_user, get_db
from app.documents import catalog_entry
from app.schemas import ChatMessage, WireModel

router = APIRouter(prefix="/api/drafts")

MAX_DRAFTS_PER_USER = 100
MAX_STORED_MESSAGES = 200
MAX_STATE_CHARS = 200_000
MAX_COMPANIES = 4

Company = Annotated[str, Field(max_length=200)]
MAX_ID = 2**63 - 1  # SQLite integers are 64-bit


class DraftIn(WireModel):
    document_type: str = Field(max_length=100)
    # The party companies, for the title shown in the list.
    companies: list[Company] = Field(default_factory=list, max_length=MAX_COMPANIES)
    state: dict[str, Any]
    messages: list[ChatMessage] = Field(max_length=MAX_STORED_MESSAGES)

    @field_validator("document_type")
    @classmethod
    def _known_document(cls, value: str) -> str:
        if catalog_entry(value) is None:
            raise ValueError("unknown document type")
        return value

    @field_validator("companies")
    @classmethod
    def _drop_blank_companies(cls, value: list[str]) -> list[str]:
        return [company.strip() for company in value if company.strip()]

    @model_validator(mode="after")
    def _state_not_too_large(self) -> "DraftIn":
        if len(json.dumps(self.state)) > MAX_STATE_CHARS:
            raise ValueError("the document is too large to save")
        return self


class DraftSummary(WireModel):
    id: int
    document_type: str
    document_name: str
    companies: list[str]
    created_at: str
    updated_at: str


class DraftOut(DraftSummary):
    state: dict[str, Any]
    messages: list[ChatMessage]


def _summary(row: sqlite3.Row) -> dict[str, Any]:
    entry = catalog_entry(row["document_type"])
    return {
        "id": row["id"],
        "document_type": row["document_type"],
        "document_name": entry.name if entry else row["document_type"],
        "companies": json.loads(row["companies"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _full(row: sqlite3.Row) -> DraftOut:
    return DraftOut(**_summary(row), state=json.loads(row["state"]), messages=json.loads(row["messages"]))


def _owned(conn: sqlite3.Connection, draft_id: int, user_id: int) -> sqlite3.Row:
    # An id SQLite cannot hold would be a server error rather than a plain "not found".
    row = None
    if 1 <= draft_id <= MAX_ID:
        row = conn.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (draft_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(404, "Document not found.")
    return row


@router.get("", response_model=list[DraftSummary], response_model_by_alias=True)
def list_drafts(user: sqlite3.Row = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        "SELECT id, document_type, companies, created_at, updated_at FROM documents "
        "WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
        (user["id"],),
    ).fetchall()
    return [_summary(row) for row in rows]


@router.post("", response_model=DraftOut, status_code=201, response_model_by_alias=True)
def create_draft(body: DraftIn, user: sqlite3.Row = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    (count,) = conn.execute("SELECT COUNT(*) FROM documents WHERE user_id = ?", (user["id"],)).fetchone()
    if count >= MAX_DRAFTS_PER_USER:
        raise HTTPException(
            409, f"You have reached the limit of {MAX_DRAFTS_PER_USER} saved documents. Delete some to save more."
        )
    now = now_iso()
    cursor = conn.execute(
        "INSERT INTO documents (user_id, document_type, companies, state, messages, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user["id"], body.document_type, json.dumps(body.companies), json.dumps(body.state), _messages(body), now, now),
    )
    conn.commit()
    return _full(_owned(conn, cursor.lastrowid, user["id"]))


def _messages(body: DraftIn) -> str:
    return json.dumps([m.model_dump() for m in body.messages])


@router.get("/{draft_id}", response_model=DraftOut, response_model_by_alias=True)
def get_draft(draft_id: int, user: sqlite3.Row = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return _full(_owned(conn, draft_id, user["id"]))


@router.put("/{draft_id}", response_model=DraftOut, response_model_by_alias=True)
def save_draft(
    draft_id: int, body: DraftIn, user: sqlite3.Row = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)
):
    _owned(conn, draft_id, user["id"])
    conn.execute(
        "UPDATE documents SET document_type = ?, companies = ?, state = ?, messages = ?, updated_at = ? "
        "WHERE id = ? AND user_id = ?",
        (body.document_type, json.dumps(body.companies), json.dumps(body.state), _messages(body), now_iso(), draft_id, user["id"]),
    )
    conn.commit()
    return _full(_owned(conn, draft_id, user["id"]))


@router.delete("/{draft_id}", status_code=204)
def delete_draft(draft_id: int, user: sqlite3.Row = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    _owned(conn, draft_id, user["id"])
    conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (draft_id, user["id"]))
    conn.commit()
    return Response(status_code=204)
