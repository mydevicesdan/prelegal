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

Sign in with any details (sign-in is a placeholder for now), then chat with the assistant at `/documents/`. It can draft the Mutual NDA, Cloud Service Agreement, Service Level Agreement, Data Processing Agreement, Design Partner Agreement, Professional Services Agreement, Partnership Agreement, Business Associate Agreement, Software License Agreement, Pilot Agreement and AI Addendum, and for anything else it explains and suggests the closest one. The SQLite database is temporary and is
recreated from scratch every time the container starts.

## Configuration

The AI chat calls an LLM through OpenRouter (Cerebras inference), so it needs an `OPENROUTER_API_KEY`.
Put it in a `.env` file in the project root:

```
OPENROUTER_API_KEY=your-key-here
```

The start scripts pass `.env` to the container at run time (it is never copied into the image). Without
the key the app still runs, but the chat answers that the assistant is not configured. The `/api/chat`
endpoint is not authenticated yet and has no rate limit, so don't expose the app publicly.

## Project layout

- `backend/`: FastAPI app managed with [uv](https://docs.astral.sh/uv/). Serves `/api/*` (`/api/chat` is the AI assistant, `/api/documents/{key}` describes a document) and the static frontend. It parses the templates in `templates/` at runtime.
  Tests: `cd backend && uv run pytest`.
- `frontend/`: Next.js app, statically exported and served by the backend.
  Tests: `cd frontend && npm test` (unit) and `npm run test:e2e` (Playwright).
- `templates/`: Common Paper legal templates. `catalog.json` lists them.

## Status

- [x] Repository created
- [ ] Core functionality
- [ ] Documentation (setup and usage)
- [ ] Release

## License

See [LICENSE](LICENSE).
*
