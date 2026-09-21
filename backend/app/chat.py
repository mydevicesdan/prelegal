import logging
import os

from fastapi import APIRouter, HTTPException

from app import llm
from app.schemas import AiTurn, ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")


@router.post("/chat", response_model=AiTurn, response_model_by_alias=True)
def chat(request: ChatRequest) -> AiTurn:
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise HTTPException(503, "The AI assistant is not configured (OPENROUTER_API_KEY is missing).")
    try:
        return llm.run_turn(request.messages, request.fields)
    except Exception:
        logger.exception("LLM call failed")
        raise HTTPException(502, "The AI assistant could not respond. Please try again.")
