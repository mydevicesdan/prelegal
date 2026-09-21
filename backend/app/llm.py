from datetime import date

from litellm import completion

from app.prompts import build_system_prompt
from app.schemas import AiTurn, ChatRequest

MODEL = "openrouter/openai/gpt-oss-120b"
# allow_fallbacks=False: never silently route to another inference provider.
EXTRA_BODY = {"provider": {"order": ["cerebras"], "allow_fallbacks": False}}

# A stalled upstream call would otherwise hold a worker thread for litellm's 100 minute default.
TIMEOUT_SECONDS = 30
MAX_OUTPUT_TOKENS = 4000


def run_turn(request: ChatRequest) -> AiTurn:
    """One model call: the reply for the user plus what to fill in."""
    system = build_system_prompt(request, date.today())
    response = completion(
        model=MODEL,
        messages=[{"role": "system", "content": system}, *(m.model_dump() for m in request.messages)],
        response_format=AiTurn,
        reasoning_effort="low",
        extra_body=EXTRA_BODY,
        timeout=TIMEOUT_SECONDS,
        num_retries=1,
        max_tokens=MAX_OUTPUT_TOKENS,
    )
    return AiTurn.model_validate_json(response.choices[0].message.content)
