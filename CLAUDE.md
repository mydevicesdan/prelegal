# Prelegal Project

## Overview

This is a SaaS product to allow users to draft legal agreements based on templates in the templates directory.
The user can carry out AI chat in order to establish what document they want and how to fill in the fields.
The available documents are covered in the catalog.json file in the project root, included here:

@catalog.json

Current state: all 11 document types in the catalog are supported through the AI chat, behind real sign up / sign in, and every draft is saved to the user's account (see "Implementation status" at the end).

## Development process

When instructed to build a feature:
1. Use your Atlassian tools to read the feature instructions from Jira
2. Develop the feature - do not skip any step from the feature-dev 7 step process
3. Thoroughly test the feature with unit tests and integration tests and fix any issues
4. Submit a PR using your github tools

## AI design

When writing code to make calls to LLMs, use your Cerebras skill to use LiteLLM via OpenRouter to the `openrouter/openai/gpt-oss-120b` model with Cerebras as the inference provider. You should use Structured Outputs so that you can interpret the results and populate fields in the legal document.

There is an OPENROUTER_API_KEY in the .env file in the project root.

## Technical design

The entire project should be packaged into a Docker container.  
The backend should be in backend/ and be a uv project, using FastAPI.  
The frontend should be in frontend/  
The database should use SQLLite and be created from scratch each time the Docker container is brought up, allowing for a users table with sign up and sign in.  
The frontend is statically built (Next.js `output: "export"`) and served by FastAPI.  
There should be scripts in scripts/ for:  
```bash
# Mac
scripts/start-mac.sh    # Start
scripts/stop-mac.sh     # Stop

# Linux
scripts/start-linux.sh
scripts/stop-linux.sh

# Windows
scripts/start-windows.ps1
scripts/stop-windows.ps1
```
Backend available at http://localhost:8000

## Color Scheme
- Accent Yellow: `#ecad0a`
- Blue Primary: `#209dd7`
- Purple Secondary: `#753991` (submit buttons)
- Dark Navy: `#032147` (headings)
- Gray Text: `#888888`

## Implementation status

Done (PL-2 to PL-7):
- `templates/` holds the Common Paper templates; `catalog.json` lists them.
- Routes (all static pages, `trailingSlash: true`): `/` sign in, `/signup/`, `/documents/` (My documents: the ledger of saved drafts), `/create/` (the editor; `?draft=ID` opens a saved draft, `?new=...` starts a fresh one, which is how the header's New document works from inside the editor).
- Editor (`components/DocumentCreator.tsx`, opened by `CreateWorkspace.tsx`): an AI chat (left) works out which document is needed and fills it in, and the agreement previews live (right) and prints to PDF. There is no form. Supported: the Mutual NDA (typed fields, its own layout: `NdaDocument`) and the 10 other catalog documents (CSA, SLA, DPA, Design Partner, PSA, Partnership, BAA, Software License, Pilot, AI Addendum), which use a generic engine.
- Accounts (PL-7): `POST /api/auth/signup|login|logout`, `GET /api/auth/session` (200 with `user: null` when nobody is signed in, so there is no 401 noise in the console). Passwords are argon2 hashes (`app/auth.py`; at most 4 hashes run at once). A session is a random token in an HttpOnly, SameSite=Lax cookie (`prelegal_session`, 30 days, `Secure` over HTTPS or with `PRELEGAL_COOKIE_SECURE=1`); only its SHA-256 is stored in `sessions`. Sign-up asks for full name, email and password (min 8). Wrong email and wrong password give the same answer (an unknown email still costs a hash). Everything under `/api` except `/api/health` and `/api/auth/*` needs a session (`app/deps.py`: `current_user`, per-request `get_db`; handlers commit explicitly).
- Rate limits (`app/ratelimit.py`, in memory, per process; env-configurable): sign-in attempts per address+email (`PRELEGAL_FAILED_LOGINS`, 10 per 15 min, cleared by a successful sign-in), failed sign-ins per address across all emails (`PRELEGAL_FAILED_LOGINS_PER_ADDRESS`, 50 per 15 min), sign-ups per address (`PRELEGAL_SIGNUPS_PER_HOUR`, 20), chat messages per user (`PRELEGAL_CHATS_PER_MINUTE`, 20). The limiter forgets expired keys and is capped at 10,000 keys. Request bodies over 4 MB are refused before being read (`app/bodylimit.py`). The address is the direct socket peer: behind a reverse proxy every client shares one address until the proxy header is trusted (not done).
- Saved drafts (PL-7): `documents` table (user_id, document_type, companies, state JSON, messages JSON, timestamps; `ON DELETE CASCADE`). `GET/POST /api/drafts`, `GET/PUT/DELETE /api/drafts/{id}` (`app/drafts_api.py`): every query is scoped to the signed-in user, so someone else's draft is a 404; an id SQLite cannot hold is a 404 too. `state` is opaque JSON owned by the frontend (max 200,000 chars, 200 messages, 4 companies, 100 drafts per user). The frontend saves automatically after every assistant turn once a document is chosen (`lib/drafts.ts`): the first save POSTs and moves the address to `?draft=ID` with `history.replaceState`, later saves PUT. Saves run one after another and wait for the document's spec (`loadSpec`, shared with the preview). If the assistant switches to another document that becomes a NEW draft (the old one stays as it was). A save that finishes after the editor was left does not touch the address. `toDraftPayload` keeps the last 200 messages (4000 chars each) and dates an undated NDA with the day it was drafted. Stored state is validated on the way back in (`parseCreatorState`). `CreateWorkspace` keeps the editor that is saving a draft rather than reloading it (`owned`), and forgets it when that editor unmounts, so Back to that address reopens the saved draft.
- The database is temporary by design: `reset_database` runs in the FastAPI lifespan, so accounts, sessions and drafts vanish on every server or container restart (default `/tmp/prelegal.db`, `PRELEGAL_DB_PATH`).
- `backend/`: FastAPI uv project (`app/`: `main`, `db`, `auth`, `auth_api`, `deps`, `drafts_api`, `ratelimit`, `bodylimit`, `static`, `chat`, `llm`, `prompts`, `schemas`, `documents`, `documents_api`). `GET /api/health`, `POST /api/chat`, `GET /api/documents/{key}`. It serves the static frontend from `PRELEGAL_STATIC_DIR` at `/`, mounted after the `/api` routes; `FrontendFiles` (`app/static.py`) also maps Next's nested payload prefetch paths (`signup/__next.signup.__PAGE__.txt` -> `signup/__next.signup/__PAGE__.txt`).
- `frontend/`: Next.js static export. `lib/api.ts` is the one way to call the backend (JSON, errors carry a message fit to show, any 401 raises `prelegal:unauthorized`); `lib/auth.tsx` (`AuthProvider`, `useAuth`) asks `/api/auth/session` who is signed in; `components/AppShell.tsx` wraps private pages (redirects to `/` when signed out, header, footer, skip link; a failed log out says "You are still signed in" instead of pretending). Sign in and sign up navigate only through the redirect that follows the state change. The Mutual NDA's templates are read from `../templates` at build time (`lib/templates.ts`), so the Docker build places `/templates` beside `/frontend`. Every other document's text comes from the backend at runtime.
- Look and feel (PL-7): flat navy brand panel on the sign-in pages, ruled ledger for My documents, no gradients; purple only for primary actions, yellow only as the "draft" cue; Public Sans for the interface and Newsreader for headings and the agreements. Brand colours are Tailwind tokens in `globals.css` (`brand-navy`, `brand-blue`, `brand-purple`, `brand-purple-dark` for hover, `brand-yellow`, `brand-gray`); `components/ui.tsx` holds the shared button, field, alert and logo. Helper text uses Tailwind `gray-500`/`gray-600` rather than `#888888`, which fails the axe contrast test. It is responsive to phone widths (the header shows the logo mark only, "New" and "Log out").
- Disclaimer (PL-7): every screen says documents are drafts subject to legal review, once per screen: the sign-in and sign-up pages (`AuthLayout`), the app footer (not on `/create/`, which has its own banner above the agreement: `DraftDisclaimer`), and the foot of every printed page. The printed one is a page margin box (`@page { @bottom-center }` in `globals.css`, Chrome/Edge); browsers without margin boxes get a fixed element instead (`PrintDisclaimer` adds `.no-margin-boxes` when `CSSMarginRule` is missing). Keep the wording of the two in step.
- Generic documents (PL-6): only the NDA has a cover page template; the other 10 templates hold just the standard terms, and what the parties must decide is referenced as `<span class="coverpage_link|keyterms_link|orderform_link|sow_link|businessterms_link">Label</span>`. `backend/app/documents.py` parses each template into a spec (fields with the sentence they are used in, party roles, terms as clean markdown with defined terms in bold; singular/plural and possessive forms merged; lettered and roman sub-clauses ("a.", "ii.") are emitted as their own paragraphs at their parent item's content column so they neither run together nor become code blocks (`_render_body`, checked over every template in `test_documents.py`); catalog.json is read from beside the templates dir, `PRELEGAL_TEMPLATES_DIR` overrides it, and the Docker image contains both). `GET /api/documents/{key}` serves it (404 for the NDA). The frontend (`GenericDocument`) generates a front page (parties, then fields grouped by Order Form / SOW / Business Terms / Key Terms) followed by the terms, a signature table and a CC BY 4.0 attribution. Defined terms are never filled inline (the terms say "The **Governing Law** will govern..."), the front page holds the values. All values are free text. Field values and parties are kept by field key / party role in `lib/creator.ts`, so they carry over when the assistant switches between generic documents; NDA <-> other switches rely on the assistant re-supplying details.
- AI chat (PL-5, extended in PL-6 and PL-7): `POST /api/chat` (needs a session; rate limited). The frontend (`lib/chat.ts`, `components/ChatPanel.tsx`) sends the message history plus what is filled in for the ACTIVE document (the NDA fields, the chosen `documentType`, generic field `values` and `parties` limited to the document's own keys and roles, so state left over from earlier documents cannot exceed the request limits; today's date is not sent as a known detail); `app/prompts.py` builds the system prompt from the conversation state (catalog of documents, how to handle unsupported requests and "we also need X" (finish the active one, offer the other), the active document's fields with current values, plain-text short replies) and `app/llm.py` makes one LiteLLM -> OpenRouter -> Cerebras call (`gpt-oss-120b`, `allow_fallbacks: false`, 30s timeout) with Structured Outputs (`app/schemas.py`: `AiTurn` = `reply`, `documentType` (null = unchanged), `updates` (NDA patch), `fieldValues` and `parties` (generic documents), patches where null means unchanged); `chat.py` sanitises it (unknown document types, field keys and party roles are dropped) and, when a turn picks or switches the document, runs the turn once more with the new `document_type` so details given in the same message are recorded. `applyTurn` (`lib/creator.ts`, which uses `applyUpdates` for the NDA) merges it into the React state held by `DocumentCreator`; a generic document's spec is fetched once, on demand, from `/api/documents/{key}`. The conversation is saved with the draft. Wire format is camelCase. Requests are capped at 4000 chars per text, 50 messages, 100 field values, 4 parties and 100 chars per key/role/document type (the frontend windows and trims to match). Needs `OPENROUTER_API_KEY` in `.env`; without it `/api/chat` returns 503.
- Multi-stage `Dockerfile` (uv pinned to 0.12.17, non-root user uid 10001, HEALTHCHECK on `/api/health`); `scripts/start-*` and `scripts/stop-*` for Mac, Linux and Windows (build, run container `prelegal` on port 8000, pass `.env` at run time only).

Testing:
- Run the whole app with `scripts/start-*` (Docker, http://localhost:8000). `npm run dev` alone has no backend, so nothing under `/api` works there (the static export has no dev proxy).
- Backend: `cd backend && uv run pytest` (LiteLLM is mocked; no API key needed). At the PL-7 merge (PR #7, merged to main): 268 backend tests, 325 frontend unit tests (+3 expected fails) and 112 e2e tests (one of them an expected failure) passed, with lint and typecheck clean.
- Frontend: `cd frontend && npm test` (Vitest, against an in-memory fake of the backend in `tests/unit/chatFixtures.ts`: chat, documents, drafts, sessions) and `npm run test:e2e` (Playwright against the REAL backend (`uv run uvicorn` on port 3100, temporary database, real sign-up/sessions/drafts); only `/api/chat` is mocked, in the browser, by `tests/e2e/chatMock.ts`; axe accessibility scans; set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome and `E2E_UV="python -m uv"` if `uv` is not on PATH; the config raises the sign-up/chat/per-address-login limits so the tests can create many users). Test data is shared in `tests/fixtures.ts`. One e2e test and two unit tests are marked `test.fail()`/`it.fails` for known defects (long unbroken values in the NDA, print-title restore); two more `it.fails` cover URL/entity handling in the NDA's governing law. Backend parser tests pin every document's fields and party roles, so a template change is noticed.
- Windows notes: use `python -m uv` if `uv` is not on PATH; the file tools decode unicode escapes and doubled backslashes in typed content, so build backslashes with `chr(92)` in scripts.

Not done yet / known issues:
- Sessions, drafts and accounts do not survive a server restart (by design for now). No email verification, password reset, account settings or account deletion in the UI.
- The rate limiter is per process and uses the socket address (see above); SQLite runs in the default journal mode (concurrent autosaves could hit "database is locked" under load).
- The NDA layout breaks with very long unbroken values (`test.fail` in `documents.spec.ts`); the page title is not restored after printing an NDA in one case (`it.fails`); URLs and HTML entities in the NDA's governing law (`it.fails`).
- A stale save error can linger after switching documents until the next save (nit). Roman sub-clauses (i., ii.) under a lettered clause are set at the same indent as the lettered ones (flat), because Markdown has no nesting for them.
- Skipped review cleanups (PL-5 to PL-7): rename the frontend `NdaUpdates` type to `NdaFields`; reuse `mergeParty`/`emptyParty` in `lib/chat.ts`, `lib/creator.ts`, `lib/documents.ts` and `lib/drafts.ts`; split `DocumentCreator` into `useDocumentSpec` / `useDraftSaver` hooks; a shared load/error/retry hook and `messageOf(error, fallback)`; one submit hook for the two auth forms; `lib/routes.ts`; one disclaimer text; simplify `drafts_api.py` (JSON column helper, `rowcount` instead of re-reading) and unify `get_db` with `db.session`; share the axe/sign-in helpers between e2e specs and rename `chatFixtures.ts` to `fakeBackend.ts`. By design: an empty string from the model overwrites a filled field (so it can clear "modifications").
