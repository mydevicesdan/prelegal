# Prelegal frontend

Next.js (App Router, TypeScript, Tailwind) prototype of the **Mutual NDA creator** (PL-3).

The user fills in a form; the page shows the Common Paper Mutual NDA (cover page + standard terms) with those details filled in, updating live. **Download PDF** opens the browser print dialog with a print-only stylesheet, so the user chooses "Save as PDF".

## Run

```bash
cd frontend
npm install
npm run dev      # http://localhost:3000
npm run build && npm start
npm run lint
```

## How it works

- The agreement text is **not** duplicated here. `lib/templates.ts` reads `../templates/Mutual-NDA-coverpage.md` and `../templates/Mutual-NDA.md` on the server at build time, so the app must be built/run from a checkout of the whole repository.
- `lib/nda.ts` holds the form types, date/term formatting and `fillStandardTerms`, which resolves the `coverpage_link` references in the standard terms (Governing Law and Jurisdiction are filled in; other references stay as defined terms). User input is markdown-escaped before substitution.
- `components/NdaForm.tsx` is the form, `components/NdaDocument.tsx` renders the agreement, and `components/NdaCreator.tsx` holds state and the download action.

Templates are © Common Paper, licensed CC BY 4.0 (see `../templates/LICENSE.txt`). This tool is not legal advice.
