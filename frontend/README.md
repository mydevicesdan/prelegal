# Prelegal frontend

Next.js (App Router, TypeScript, Tailwind) app for the **legal document creator**: the Mutual NDA and ten other Common Paper agreements.

The user chats with an AI assistant, which works out which document they need (or explains that it can't draft it and offers the closest one), asks about the details and fills them in; the page shows the agreement updating live. **Download PDF** opens the browser print dialog with a print-only stylesheet, so the user chooses "Save as PDF".

## Run

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000 (nothing under /api works here, see below)
npm run build    # static export to out/, served by the FastAPI backend
npm run lint
```

## Test

```bash
npm test                 # Vitest: unit tests for lib/ and component tests (jsdom)
npx playwright install chromium   # once
npm run test:e2e         # Playwright: builds the app, starts the real backend, runs against real Chromium
```

Set `PLAYWRIGHT_CHANNEL=chrome` (or `msedge`) to use an installed browser instead of downloading one. The e2e tests start the backend with `uv run`; if `uv` is not on your PATH set `E2E_UV` (e.g. `E2E_UV="python -m uv"`). They use a temporary database and create their own users, and only the AI call is mocked (in the browser, `tests/e2e/chatMock.ts`); sign-up, sessions and saved documents are the real thing.

Tests marked `it.fails` (Vitest) or `test.fail()` (Playwright) document known, reproducible defects; they pass while the defect exists and go red once it is fixed, at which point the marker should be removed.

## How it works

- Pages (all static, `next.config.ts` exports them with trailing slashes): `/` sign in, `/signup/`, `/documents/` (My documents: the ledger of saved drafts), and `/create/` (the editor; `?draft=ID` opens a saved document, `?new=...` starts a fresh one, which is how the header's New document works from inside the editor).
- `lib/api.ts` is the one way the frontend talks to the backend: JSON in and out, errors carry a message fit to show, and any 401 raises a window event so the app returns to sign in. `lib/auth.tsx` (`AuthProvider`, `useAuth`) asks `/api/auth/session` who is signed in (the session is an HttpOnly cookie the page cannot read). `components/AppShell.tsx` wraps private pages: it sends visitors who are not signed in to `/`, and provides the header, footer and skip link.
- Saving: `components/DocumentCreator.tsx` saves the draft after every assistant turn once a document has been chosen (`lib/drafts.ts`): the first save creates it and moves the address to `?draft=ID`, later ones update it. Saves run one after another and wait for the document's details (`loadSpec`, shared with the preview). If the assistant switches to a different document that becomes a **new draft** (the earlier one stays exactly as it was; the details that carry over are copied). `components/CreateWorkspace.tsx` opens a saved draft from the address, and takes care not to reload the draft the editor is itself in the middle of saving. Stored state is validated on the way back in (`parseCreatorState`).
- Look and feel: the palette is in `app/globals.css` (navy for headings, purple for the main action, blue for focus, yellow only to mark a draft); Public Sans for the interface and Newsreader for headings and the agreements. `components/ui.tsx` holds the shared button, field, alert and logo. Every page says documents are drafts subject to legal review: `components/Disclaimer.tsx` (a banner above the agreement, and a line fixed to the foot of every printed page), the app footer, and the sign-in and sign-up pages.

- The agreement text is **not** duplicated here. `lib/templates.ts` reads `../templates/Mutual-NDA-coverpage.md` and `../templates/Mutual-NDA.md` on the server at build time, so the app must be built/run from a checkout of the whole repository.
- `lib/nda.ts` holds the document field types, date/term formatting and `fillStandardTerms`, which resolves the `coverpage_link` references in the standard terms (Governing Law and Jurisdiction are filled in; other references stay as defined terms). User input is markdown-escaped before substitution.
- `components/ChatPanel.tsx` is the chat. Each message is sent to `POST /api/chat` (see `lib/chat.ts`) with the conversation and everything filled in so far; the reply names the document (`documentType`) and carries what the assistant filled in. `lib/creator.ts` (`applyTurn`) merges it into the state held by `components/DocumentCreator.tsx`, which also handles the download action.
- The Mutual NDA has typed fields and its own layout (`components/NdaDocument.tsx`, `lib/nda.ts`). Every other document is described by a spec that the backend builds from its template (`GET /api/documents/{key}`: party roles, fields, and the terms as markdown, see `lib/documents.ts`); `components/GenericDocument.tsx` renders a generated front page (parties, then the fields grouped by Order Form / Key Terms / ...) followed by the standard terms. Values are kept by field key and party role, so they carry over when the assistant switches between such documents.
- Everything under `/api` only exists behind the FastAPI backend (`../backend`), so `npm run dev` on its own can't sign in or chat; run the whole app with `scripts/start-*` from the repo root. The unit tests need no backend or API key: they run against an in-memory fake of it (`tests/unit/chatFixtures.ts`: chat, documents, drafts and sessions), with shared test data in `tests/fixtures.ts`.

Templates are © Common Paper, licensed CC BY 4.0 (see `../templates/LICENSE.txt`). This tool is not legal advice.
