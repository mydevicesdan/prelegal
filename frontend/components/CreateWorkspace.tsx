"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { getDraft, parseCreatorState, parseMessages } from "@/lib/drafts";
import type { MutualNdaTemplates } from "@/lib/templates";
import { DocumentCreator, NEW_SESSION, type EditorSession } from "./DocumentCreator";
import { Alert, Button, ButtonLink, Spinner } from "./ui";

/** What came back when a saved draft was opened. */
interface Opened {
  id: number;
  /** Distinguishes one opening of a draft from the next, so reopening it starts a fresh editor. */
  nonce: number;
  outcome: { kind: "ready"; session: EditorSession } | { kind: "missing" } | { kind: "error"; message: string };
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">{children}</div>;
}

/**
 * The editor page: a fresh document (`/create/`), or a saved one (`/create/?draft=12`). The address says which
 * one is open. The editor also moves the address to `?draft=ID` itself when it first saves; that must keep the
 * editor that is already on screen rather than reload the draft it is in the middle of editing.
 */
export function CreateWorkspace({ templates }: { templates: MutualNdaTemplates }) {
  const params = useSearchParams();
  const draftParam = params.get("draft");
  const newParam = params.get("new") ?? "";
  // Digits only: "1e2" or "0x10" are not draft numbers, however Number() reads them.
  const draftId = draftParam === null ? null : /^\d{1,15}$/.test(draftParam) ? Number(draftParam) : NaN;
  const validId = draftId !== null && Number.isSafeInteger(draftId) && draftId > 0;

  // The draft the editor on screen saves to, and which editor that is.
  const [owned, setOwned] = useState<{ id: number; key: string } | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!validId || draftId === owned?.id) return;
    let cancelled = false;
    const done = (outcome: Opened["outcome"]) => !cancelled && setOpened({ id: draftId, nonce: Date.now(), outcome });
    getDraft(draftId).then(
      (draft) =>
        done({
          kind: "ready",
          session: { draftId: draft.id, state: parseCreatorState(draft.state), messages: parseMessages(draft.messages) },
        }),
      (error: unknown) =>
        done(
          error instanceof ApiError && error.status === 404
            ? { kind: "missing" }
            : { kind: "error", message: error instanceof Error ? error.message : "Could not open the document." },
        ),
    );
    return () => {
      cancelled = true;
    };
  }, [validId, draftId, owned?.id, attempt]);

  const editor = (key: string, session: EditorSession) => (
    <DocumentCreator
      key={key}
      templates={templates}
      session={session}
      onDraftId={(id) => setOwned({ id, key })}
      // Once it has left the screen it is no longer "already on screen": coming back to its address reopens the
      // saved draft instead of mounting an empty editor.
      onClose={() => setOwned((current) => (current?.key === key ? null : current))}
    />
  );

  if (draftId === null) return editor(`new-${newParam}`, NEW_SESSION);
  if (owned && owned.id === draftId) return editor(owned.key, NEW_SESSION); // already on screen: the session is ignored

  const current = validId && opened?.id === draftId ? opened : null;
  if (!validId || current?.outcome.kind === "missing") {
    return (
      <Centered>
        <h1 className="font-display text-3xl font-semibold text-brand-navy">Document not found</h1>
        <p className="text-gray-600">It may have been deleted. Your other drafts are in My documents.</p>
        <div className="flex gap-3">
          <ButtonLink href="/documents/">Go to My documents</ButtonLink>
          <ButtonLink href="/create/" variant="secondary">
            Start a new document
          </ButtonLink>
        </div>
      </Centered>
    );
  }
  if (current?.outcome.kind === "error") {
    return (
      <Centered>
        <Alert>{current.outcome.message}</Alert>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setOpened(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
          <Link href="/documents/" className="text-sm font-semibold text-brand-navy underline underline-offset-2">
            Back to My documents
          </Link>
        </div>
      </Centered>
    );
  }
  if (current?.outcome.kind === "ready") return editor(`draft-${current.id}-${current.nonce}`, current.outcome.session);

  return (
    <Centered>
      <div role="status" className="flex flex-col items-center gap-3 text-gray-600">
        <Spinner className="h-6 w-6" />
        <span>Opening your document…</span>
      </div>
    </Centered>
  );
}
