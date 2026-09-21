import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from app import llm
from app.deps import chat_rate_limit
from app.documents import NDA_KEY, catalog_entry, get_spec
from app.schemas import AiTurn, ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


def _known_document(key: str | None) -> str | None:
    return key if key and catalog_entry(key) else None


def _sanitise(turn: AiTurn, current_type: str | None) -> AiTurn:
    """Keeps only what makes sense for the active document: a known document type, and updates for the
    right kind of document with known field keys and party roles. Model slips are dropped, not errors."""
    chosen = _known_document(turn.document_type)
    active = chosen or current_type
    spec = get_spec(active) if active else None
    field_values = parties = None
    if spec:
        keys = {f.key for f in spec.fields}
        field_values = [v for v in turn.field_values or [] if v.key in keys]
        parties = [p for p in turn.parties or [] if p.role in spec.parties]
    return AiTurn(
        reply=turn.reply,
        document_type=chosen,
        updates=turn.updates if active == NDA_KEY else None,
        field_values=field_values,
        parties=parties,
    )


@router.post("/chat", response_model=AiTurn, response_model_by_alias=True, dependencies=[Depends(chat_rate_limit)])
def chat(request: ChatRequest) -> AiTurn:
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise HTTPException(503, "The AI assistant is not configured (OPENROUTER_API_KEY is missing).")
    try:
        turn = llm.run_turn(request)
        chosen = _known_document(turn.document_type)
        if chosen and chosen != request.document_type:
            # The message that picked (or switched) the document may also have carried details, but the model
            # did not know this document's fields yet, so it could not record them. Ask again now that it does.
            turn = llm.run_turn(request.model_copy(update={"document_type": chosen}))
            turn = turn.model_copy(update={"document_type": chosen})
        return _sanitise(turn, request.document_type)
    except Exception:
        logger.exception("LLM call failed")
        raise HTTPException(502, "The AI assistant could not respond. Please try again.")
