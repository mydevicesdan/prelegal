# Prelegal frontend

Next.js (App Router, TypeScript, Tailwind) app for the **legal document creator**: the Mutual NDA and ten other Common Paper agreements.

The user chats with an AI assistant, which works out which document they need (or explains that it can't draft it and offers the closest one), asks about the details and fills them in; the page shows the agreement updating live. **Download PDF** opens the browser print dialog with a print-only stylesheet, so the user chooses "Save as PDF".

## Run

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000 (the chat needs the backend, see below)
npm run build    # static export to out/, served by the FastAPI backend
npm run lint
```

## Test

```bash
npm test                 # Vitest: unit tests for lib/ and component tests (jsdom)
npx playwright install chromium   # once
npm run test:e2e         # Playwright: builds and serves the app, runs against real Chromium
```

Set `PLAYWRIGHT_CHANNEL=chrome` (or `msedge`) to use an installed browser instead of downloading one.

Tests marked `it.fails` (Vitest) or `test.fail()` (Playwright) document known, reproducible defects; they pass while the defect exists and go red once it is fixed, at which point the marker should be removed.

## How it works

- The agreement text is **not** duplicated here. `lib/templates.ts` reads `../templates/Mutual-NDA-coverpage.md` and `../templates/Mutual-NDA.md` on the server at build time, so the app must be built/run from a checkout of the whole repository.
- `lib/nda.ts` holds the document field types, date/term formatting and `fillStandardTerms`, which resolves the `coverpage_link` references in the standard terms (Governing Law and Jurisdiction are filled in; other references stay as defined terms). User input is markdown-escaped before substitution.
- `components/ChatPanel.tsx` is the chat. Each message is sent to `POST /api/chat` (see `lib/chat.ts`) with the conversation and everything filled in so far; the reply names the document (`documentType`) and carries what the assistant filled in. `lib/creator.ts` (`applyTurn`) merges it into the state held by `components/DocumentCreator.tsx`, which also handles the download action.
- The Mutual NDA has typed fields and its own layout (`components/NdaDocument.tsx`, `lib/nda.ts`). Every other document is described by a spec that the backend builds from its template (`GET /api/documents/{key}`: party roles, fields, and the terms as markdown, see `lib/documents.ts`); `components/GenericDocument.tsx` renders a generated front page (parties, then the fields grouped by Order Form / Key Terms / ...) followed by the standard terms. Values are kept by field key and party role, so they carry over when the assistant switches between such documents.
- `/api/chat` and `/api/documents/{key}` only exist behind the FastAPI backend (`../backend`). `npm run dev` on its own can't chat; run the whole app with `scripts/start-*` from the repo root. The Playwright tests mock both endpoints (`tests/e2e/chatMock.ts`) and the unit tests mock `fetch` (`tests/unit/chatFixtures.ts`), with test data in `tests/fixtures.ts`, so they need no backend or API key.

Templates are © Common Paper, licensed CC BY 4.0 (see `../templates/LICENSE.txt`). This tool is not legal advice.
