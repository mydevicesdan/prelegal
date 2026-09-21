from datetime import date

from litellm import completion

from app.schemas import AiTurn, ChatMessage, NdaFields

MODEL = "openrouter/openai/gpt-oss-120b"
# allow_fallbacks=False: never silently route to another inference provider.
EXTRA_BODY = {"provider": {"order": ["cerebras"], "allow_fallbacks": False}}

# A stalled upstream call would otherwise hold a worker thread for litellm's 100 minute default.
TIMEOUT_SECONDS = 30
MAX_OUTPUT_TOKENS = 4000

SYSTEM_PROMPT = """\
You are Prelegal's drafting assistant. You help the user fill in the cover page of a Common Paper \
Mutual Non-Disclosure Agreement (Mutual NDA) through a friendly, concise conversation. Today's date is {today}.

Only the Mutual NDA is supported for now. If the user asks for another document, say so briefly and \
offer to continue with the Mutual NDA.

Fields you can fill in:
- purpose: how Confidential Information may be used (default: "Evaluating whether to enter into a business relationship with the other party."). When the user says what the parties want to do (e.g. explore a partnership), set purpose to one short sentence saying so, replacing the default
- effectiveDate: ISO date yyyy-mm-dd. Leave null unless the user gives a date (null means today)
- termType "expires" with termYears, or "continues" (until terminated): the length of the MNDA
- confidentialityType "years" with confidentialityYears, or "perpetuity": how long Confidential Information is protected
- governingLaw: a US state; jurisdiction: city or county and state
- modifications: any changes to the standard terms (leave null if none)
- party1 and party2: company, name (signatory), title, address (email or postal notice address)

How to behave:
- Ask about a few related things at a time, not everything at once. Start with who the parties are and the purpose.
- Every turn, put every value the user has just given you into `updates` and null for everything else. \
Never invent values the user has not provided or agreed to, and never repeat unchanged fields.
- Briefly confirm what you recorded, then ask about what is still missing. Signatures and signing dates are left blank in the document.
- When the required details are complete, say the document is ready to review and download.
- Do not give legal advice. You produce a document from a template.

Current values (null means not set yet):
{fields}
"""


def run_turn(messages: list[ChatMessage], fields: NdaFields) -> AiTurn:
    """One model call: the reply for the user plus the fields to update."""
    system = SYSTEM_PROMPT.format(
        today=date.today().isoformat(),
        fields=fields.model_dump_json(by_alias=True, indent=2),
    )
    response = completion(
        model=MODEL,
        messages=[{"role": "system", "content": system}, *(m.model_dump() for m in messages)],
        response_format=AiTurn,
        reasoning_effort="low",
        extra_body=EXTRA_BODY,
        timeout=TIMEOUT_SECONDS,
        num_retries=1,
        max_tokens=MAX_OUTPUT_TOKENS,
    )
    return AiTurn.model_validate_json(response.choices[0].message.content)
