"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ChatReply } from "@/lib/chat";
import { applyTurn, initialCreatorState, type CreatorState } from "@/lib/creator";
import {
  NDA_KEY,
  NDA_NAME,
  documentTitle,
  fetchDocumentSpec,
  progress,
  type DocumentSpec,
} from "@/lib/documents";
import { todayIso, type NdaFormData } from "@/lib/nda";
import type { MutualNdaTemplates } from "@/lib/templates";
import { ChatPanel } from "./ChatPanel";
import { GenericDocument } from "./GenericDocument";
import { NdaDocument } from "./NdaDocument";

function ndaTitle({ party1, party2 }: NdaFormData): string {
  const names = [party1.company, party2.company].map((c) => c.trim()).filter(Boolean);
  return ["Mutual NDA", ...names].join(" - ");
}

const subscribeNever = () => () => {};

/** Today's local date on the client, "" while prerendering, so the static page doesn't bake in the build date. */
function useToday(): string {
  return useSyncExternalStore(subscribeNever, todayIso, () => "");
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
      {children}
    </div>
  );
}

export function DocumentCreator({ templates }: { templates: MutualNdaTemplates }) {
  const [state, setState] = useState<CreatorState>(initialCreatorState);
  const [specs, setSpecs] = useState<Record<string, DocumentSpec>>({});
  const [specError, setSpecError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const today = useToday();

  const isNda = state.documentType === NDA_KEY;
  const genericKey = state.documentType && !isNda ? state.documentType : null;
  const spec = genericKey ? specs[genericKey] : undefined;
  const loadError = specError && specError.key === genericKey ? specError.message : null;
  const data: NdaFormData = { ...state.nda, effectiveDate: state.nda.effectiveDate ?? today };

  // The assistant chooses the document; its spec (fields and terms) comes from the backend once, on demand.
  useEffect(() => {
    if (!genericKey || specs[genericKey]) return;
    let cancelled = false;
    fetchDocumentSpec(genericKey).then(
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
  }, [genericKey, specs, attempt]);

  const retryLoading = () => {
    setSpecError(null);
    setAttempt((n) => n + 1);
  };

  const onTurn = (turn: ChatReply) => setState((current) => applyTurn(current, turn));

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

  let status: string | null = null;
  if (isNda) status = `Drafting: ${NDA_NAME}`;
  else if (spec) {
    const { filled, total } = progress(spec, state.values);
    status = `Drafting: ${spec.name} · ${filled} of ${total} details filled in`;
  }

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
  else if (genericKey) preview = <PreviewMessage>Loading the document…</PreviewMessage>;
  else
    preview = (
      <PreviewMessage>
        Your document will appear here once you and the assistant have chosen one.
      </PreviewMessage>
    );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">Legal document creator</h1>
          <p className="mt-1 text-sm text-gray-600">
            Chat with the assistant and the agreement fills in as you go. When it
            looks right, download it as a PDF.
          </p>
          {status && (
            <p className="mt-1 text-sm font-medium text-brand-navy" aria-live="polite">
              {status}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={!ready}
          className="rounded-md bg-brand-purple px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-purple/90 focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:opacity-50"
        >
          Download PDF
        </button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[24rem_minmax(0,1fr)] print:block">
        <div className="print:hidden">
          <ChatPanel
            context={{
              data,
              documentType: state.documentType,
              values: state.values,
              parties: state.parties,
            }}
            onTurn={onTurn}
          />
        </div>
        <div className="min-w-0">{preview}</div>
      </div>

      <p className="mt-6 text-xs text-gray-500 print:hidden">
        Choose “Save as PDF” as the destination in the print dialog. This tool
        produces a document from a template and is not legal advice.
      </p>
    </div>
  );
}
