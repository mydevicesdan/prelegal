# Prelegal frontend

Next.js (App Router, TypeScript, Tailwind) app for the **Mutual NDA creator**.

The user chats with an AI assistant, which asks about the agreement and fills in the details; the page shows the Common Paper Mutual NDA (cover page + standard terms) updating live. **Download PDF** opens the browser print dialog with a print-only stylesheet, so the user chooses "Save as PDF".

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
- `components/ChatPanel.tsx` is the chat. Each message is sent to `POST /api/chat` (see `lib/chat.ts`) with the conversation and the current fields; the reply carries the fields the assistant filled in, which `applyUpdates` merges into the state held by `components/NdaCreator.tsx`. `components/NdaDocument.tsx` renders the agreement, and `NdaCreator` also handles the download action.
- `/api/chat` only exists behind the FastAPI backend (`../backend`). `npm run dev` on its own can't chat; run the whole app with `scripts/start-*` from the repo root. The Playwright tests mock `/api/chat` (`tests/e2e/chatMock.ts`) and the unit tests mock `fetch`, so they need no backend or API key.

Templates are © Common Paper, licensed CC BY 4.0 (see `../templates/LICENSE.txt`). This tool is not legal advice.
