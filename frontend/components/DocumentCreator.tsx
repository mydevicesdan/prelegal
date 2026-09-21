"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ChatMessage, ChatReply } from "@/lib/chat";
import { applyTurn, initialCreatorState, type CreatorState } from "@/lib/creator";
import {
  NDA_KEY,
  NDA_NAME,
  documentTitle,
  fetchDocumentSpec,
  progress,
  type DocumentSpec,
} from "@/lib/documents";
import { createDraft, saveDraft, toDraftPayload } from "@/lib/drafts";
import { todayIso, type NdaFormData } from "@/lib/nda";
import type { MutualNdaTemplates } from "@/lib/templates";
import { ChatPanel } from "./ChatPanel";
import { DraftDisclaimer, PrintDisclaimer } from "./Disclaimer";
import { GenericDocument } from "./GenericDocument";
import { NdaDocument } from "./NdaDocument";
import { Button, Spinner } from "./ui";

/** Where the editor starts: a fresh document, or one that was saved earlier. */
export interface EditorSession {
  draftId: number | null;
  state: CreatorState;
  messages: ChatMessage[];
}

export const NEW_SESSION: EditorSession = { draftId: null, state: initialCreatorState, messages: [] };

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

/** Which saved draft an editing session writes to. Switching to another document starts a new one. */
interface Slot {
  id: number | null;
}

function ndaTitle({ party1, party2 }: NdaFormData): string {
  const names = [party1.company, party2.company].map((c) => c.trim()).filter(Boolean);
  return ["Mutual NDA", ...names].join(" - ");
}

function pick<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  return Object.fromEntries(keys.filter((key) => key in record).map((key) => [key, record[key]!]));
}

const subscribeNever = () => () => {};

/** Today's local date on the client, "" while prerendering, so the static page doesn't bake in the build date. */
function useToday(): string {
  return useSyncExternalStore(subscribeNever, todayIso, () => "");
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-600">
      {children}
    </div>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.kind === "idle") return null;
  if (status.kind === "saving") {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-gray-600">
        <Spinner className="h-3.5 w-3.5" />
        Saving…
      </span>
    );
  }
  if (status.kind === "saved") {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-gray-700">
        <svg viewBox="0 0 16 16" className="h-4 w-4 text-green-700" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Saved to My documents
      </span>
    );
  }
  return (
    <span role="alert" className="inline-flex items-center gap-2 font-medium text-red-700">
      Couldn&apos;t save this draft.
      <button type="button" onClick={onRetry} className="underline underline-offset-2">
        Try again
      </button>
    </span>
  );
}

export function DocumentCreator({
  templates,
  session = NEW_SESSION,
  onDraftId,
  onClose,
}: {
  templates: MutualNdaTemplates;
  session?: EditorSession;
  /** Called when a draft is first saved, with its id, so the page can follow it. */
  onDraftId?: (id: number) => void;
  /** Called when the editor leaves the screen. */
  onClose?: () => void;
}) {
  const [state, setState] = useState<CreatorState>(session.state);
  const stateRef = useRef(session.state);
  const [specs, setSpecs] = useState<Record<string, DocumentSpec>>({});
  const [specError, setSpecError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(
    session.draftId === null ? { kind: "idle" } : { kind: "saved" },
  );
  const slot = useRef<Slot>({ id: session.draftId });
  const saves = useRef<Promise<void>>(Promise.resolve());
  const failedSave = useRef<{ target: Slot; state: CreatorState; conversation: ChatMessage[] } | null>(null);
  const specLoads = useRef(new Map<string, Promise<DocumentSpec>>());
  const mounted = useRef(false);
  const closeRef = useRef(onClose);
  const today = useToday();

  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      closeRef.current?.();
    };
  }, []);

  const isNda = state.documentType === NDA_KEY;
  const genericKey = state.documentType && !isNda ? state.documentType : null;
  const spec = genericKey ? specs[genericKey] : undefined;
  const loadError = specError && specError.key === genericKey ? specError.message : null;
  const data: NdaFormData = { ...state.nda, effectiveDate: state.nda.effectiveDate ?? today };

  /** A document's spec, fetched once and shared by whoever asks (the preview, and saving). Failures are not kept. */
  const loadSpec = useCallback((key: string) => {
    let pending = specLoads.current.get(key);
    if (!pending) {
      pending = fetchDocumentSpec(key);
      specLoads.current.set(key, pending);
      pending.catch(() => specLoads.current.delete(key));
    }
    return pending;
  }, []);

  // The assistant chooses the document; its spec (fields and terms) comes from the backend once, on demand.
  useEffect(() => {
    if (!genericKey || specs[genericKey]) return;
    let cancelled = false;
    loadSpec(genericKey).then(
      (loaded) => {
        if (!cancelled) setSpecs((current) => ({ ...current, [genericKey]: loaded }));
      },
      (error: Error) => {
        if (!cancelled) setSpecError({ key: genericKey, message: error.message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [genericKey, specs, attempt, loadSpec]);

  const retryLoading = () => {
    setSpecError(null);
    setAttempt((n) => n + 1);
  };

  /**
   * Saves the draft. Saves run one after another, so a slow first save can never overtake the next one, and
   * each goes to the draft it was made for even if the user has since moved on to another document. It waits
   * for the document's details (they say which party is which), which the preview is loading anyway.
   */
  const persist = useCallback(
    (target: Slot, savedState: CreatorState, conversation: ChatMessage[]) => {
      const current = () => slot.current === target;
      if (current()) setSaveStatus({ kind: "saving" });
      saves.current = saves.current.then(async () => {
        try {
          const key = savedState.documentType;
          const details = key && key !== NDA_KEY ? await loadSpec(key).catch(() => undefined) : undefined;
          const payload = toDraftPayload(savedState, conversation, details);
          if (target.id === null) {
            const created = await createDraft(payload);
            target.id = created.id;
            // A save that finishes after the user has left must not move the address of the page they are on now.
            if (current() && mounted.current) {
              onDraftId?.(created.id);
              window.history.replaceState(window.history.state, "", `/create/?draft=${created.id}`);
            }
          } else {
            await saveDraft(target.id, payload);
          }
          if (current()) {
            failedSave.current = null;
            setSaveStatus({ kind: "saved" });
          }
        } catch (error) {
          if (current()) {
            failedSave.current = { target, state: savedState, conversation };
            setSaveStatus({
              kind: "error",
              message: error instanceof Error ? error.message : "Could not save.",
            });
          }
        }
      });
    },
    [onDraftId, loadSpec],
  );

  const onTurn = (turn: ChatReply, conversation: ChatMessage[]) => {
    const before = stateRef.current;
    const after = applyTurn(before, turn);
    stateRef.current = after;
    setState(after);

    if (after.documentType === null) return; // nothing worth saving until a document has been chosen
    if (before.documentType !== null && before.documentType !== after.documentType) {
      // A different document is a new draft: the earlier one stays saved exactly as it was.
      slot.current = { id: null };
    }
    persist(slot.current, after, conversation);
  };

  const ready = isNda || spec !== undefined;

  // The browser uses the page title as the default PDF file name.
  const download = () => {
    const originalTitle = document.title;
    document.title = isNda ? ndaTitle(data) : documentTitle(spec!, state.parties);
    window.addEventListener("afterprint", () => (document.title = originalTitle), {
      once: true,
    });
    window.print();
  };

  // The assistant only needs the active document's details; what is left over from earlier documents stays out
  // of the request (it would eventually exceed the request limits).
  const chatValues = spec ? pick(state.values, spec.fields.map((f) => f.key)) : state.values;
  const chatParties = spec ? pick(state.parties, spec.parties) : state.parties;

  const heading = isNda ? NDA_NAME : spec ? spec.name : genericKey ? "Loading document" : "New document";
  const details = spec ? progress(spec, state.values) : null;

  let preview: ReactNode;
  if (isNda) preview = <NdaDocument data={data} templates={templates} />;
  else if (spec) preview = <GenericDocument spec={spec} values={state.values} parties={state.parties} />;
  else if (loadError)
    preview = (
      <PreviewMessage>
        <div role="alert">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={retryLoading}
            className="mt-2 font-semibold underline underline-offset-2"
          >
            Try loading it again
          </button>
        </div>
      </PreviewMessage>
    );
  else if (genericKey)
    preview = (
      <PreviewMessage>
        <span role="status">Loading the document…</span>
      </PreviewMessage>
    );
  else
    preview = (
      <PreviewMessage>
        Your document will appear here once you and the assistant have chosen one.
      </PreviewMessage>
    );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-navy">{heading}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            {/* Always in the page, so screen readers announce changes to it. */}
            <div aria-live="polite" className="flex items-center gap-2.5 text-gray-700">
              {details && (
                <>
                  <div
                    role="progressbar"
                    aria-label="Details filled in"
                    aria-valuemin={0}
                    aria-valuemax={details.total}
                    aria-valuenow={details.filled}
                    className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-200"
                  >
                    <div
                      className="h-full rounded-full bg-brand-blue transition-[width] duration-300 motion-reduce:transition-none"
                      style={{ width: `${details.total ? (details.filled / details.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span>
                    {details.filled} of {details.total} details filled in
                  </span>
                </>
              )}
            </div>
            <SaveIndicator
              status={saveStatus}
              onRetry={() => {
                const failed = failedSave.current;
                if (failed) persist(failed.target, failed.state, failed.conversation);
              }}
            />
          </div>
        </div>
        <Button onClick={download} disabled={!ready}>
          Download PDF
        </Button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[26rem_minmax(0,1fr)] print:block">
        <div className="print:hidden lg:sticky lg:top-24 lg:self-start">
          <ChatPanel
            context={{
              // What the user has actually said: an effective date nobody chose is not a detail to reuse.
              data: { ...state.nda, effectiveDate: state.nda.effectiveDate ?? "" },
              documentType: state.documentType,
              values: chatValues,
              parties: chatParties,
            }}
            onTurn={onTurn}
            initialMessages={session.messages}
          />
        </div>
        <div className="min-w-0">
          {ready && <DraftDisclaimer />}
          {preview}
          {ready && <PrintDisclaimer />}
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-600 print:hidden">
        Choose “Save as PDF” as the destination in the print dialog.
      </p>
    </div>
  );
}
