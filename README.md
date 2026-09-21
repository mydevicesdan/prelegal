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

Sign-in is a placeholder for now: any details let you in. The SQLite database is temporary and is
recreated from scratch every time the container starts. If a `.env` file exists in the project root it is
passed to the container (it is never copied into the image).

## Project layout

- `backend/`: FastAPI app managed with [uv](https://docs.astral.sh/uv/). Serves `/api/*` and the static frontend.
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
