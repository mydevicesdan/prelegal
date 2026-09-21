# Prelegal

> **Status: In progress 🚧**
> This project is under active development and is expected to be completed within 1 week (target: 2026-09-26).

## About

Prelegal is a work in progress. Details on features, setup, and usage will be added as the project nears completion.

## Running the app

Requires [Docker](https://www.docker.com/). The app is served at http://localhost:8000.

| OS      | Start                        | Stop                        |
|---------|------------------------------|-----------------------------|
| Mac     | `scripts/start-mac.sh`       | `scripts/stop-mac.sh`       |
| Linux   | `scripts/start-linux.sh`     | `scripts/stop-linux.sh`     |
| Windows | `scripts/start-windows.ps1`  | `scripts/stop-windows.ps1`  |

Create an account, then chat with the assistant. It can draft the Mutual NDA, Cloud Service Agreement, Service Level Agreement, Data Processing Agreement, Design Partner Agreement, Professional Services Agreement, Partnership Agreement, Business Associate Agreement, Software License Agreement, Pilot Agreement and AI Addendum, and for anything else it explains and suggests the closest one. Every document is saved to your account as you
chat and listed in **My documents**, where you can reopen it, keep editing, download it as a PDF or delete it.
Documents are drafts: every screen and every printed page says they are subject to legal review.

The SQLite database is temporary: it is recreated from scratch every time the container starts, so accounts and
saved documents do not survive a restart.

## Configuration

The AI chat calls an LLM through OpenRouter (Cerebras inference), so it needs an `OPENROUTER_API_KEY`.
Put it in a `.env` file in the project root:

```
OPENROUTER_API_KEY=your-key-here
```

The start scripts pass `.env` to the container at run time (it is never copied into the image). Without
the key the app still runs, but the chat answers that the assistant is not configured.

Everything under `/api` needs a signed-in user (an HttpOnly session cookie), except `/api/health` and the sign-in and
sign-up endpoints (`/api/auth/*`). Sign-ins, sign-ups and chat messages are rate limited, and the limits can be
changed with environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `PRELEGAL_FAILED_LOGINS` | 10 | Sign-in attempts per address and email in 15 minutes (a successful sign-in clears the count) |
| `PRELEGAL_FAILED_LOGINS_PER_ADDRESS` | 50 | Failed sign-ins per address, across all emails, in 15 minutes |
| `PRELEGAL_SIGNUPS_PER_HOUR` | 20 | Sign-up attempts per address per hour |
| `PRELEGAL_CHATS_PER_MINUTE` | 20 | Chat messages per user per minute |
| `PRELEGAL_COOKIE_SECURE` | unset | Set to `1` to mark the session cookie `Secure` (it is anyway over HTTPS) |

Pass them the same way as the key, or add them to `.env`.

## Project layout

- `backend/`: FastAPI app managed with [uv](https://docs.astral.sh/uv/). Serves `/api/*` (`/api/auth/*` accounts and sessions, `/api/drafts` saved documents, `/api/chat` the AI assistant, `/api/documents/{key}` describes a document) and the static frontend. It parses the templates in `templates/` at runtime.
  Tests: `cd backend && uv run pytest`.
- `frontend/`: Next.js app, statically exported and served by the backend.
  Tests: `cd frontend && npm test` (unit) and `npm run test:e2e` (Playwright, against the real backend; set `E2E_UV` if `uv` is not on your PATH, e.g. `E2E_UV="python -m uv"`).
- `templates/`: Common Paper legal templates. `catalog.json` lists them.

## Status

- [x] Repository created
- [ ] Core functionality
- [ ] Documentation (setup and usage)
- [ ] Release

## License

See [LICENSE](LICENSE).
