"use client";

import { useState, useSyncExternalStore } from "react";
import {
  initialFormState,
  todayIso,
  type NdaFormData,
  type NdaFormState,
  type Party,
} from "@/lib/nda";
import type { MutualNdaTemplates } from "@/lib/templates";
import { NdaDocument } from "./NdaDocument";
import { NdaForm } from "./NdaForm";

function documentTitle({ party1, party2 }: NdaFormData): string {
  const names = [party1.company, party2.company].map((c) => c.trim()).filter(Boolean);
  return ["Mutual NDA", ...names].join(" - ");
}

const subscribeNever = () => () => {};

/** Today's local date on the client, "" while prerendering, so the static page doesn't bake in the build date. */
function useToday(): string {
  return useSyncExternalStore(subscribeNever, todayIso, () => "");
}

export function NdaCreator({ templates }: { templates: MutualNdaTemplates }) {
  const [state, setState] = useState<NdaFormState>(initialFormState);
  const today = useToday();
  const data: NdaFormData = { ...state, effectiveDate: state.effectiveDate ?? today };

  const update = (patch: Partial<NdaFormData>) =>
    setState((current) => ({ ...current, ...patch }));

  const updateParty = (which: "party1" | "party2", patch: Partial<Party>) =>
    setState((current) => ({ ...current, [which]: { ...current[which], ...patch } }));

  // The browser uses the page title as the default PDF file name.
  const download = () => {
    const originalTitle = document.title;
    document.title = documentTitle(data);
    window.addEventListener("afterprint", () => (document.title = originalTitle), {
      once: true,
    });
    window.print();
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mutual NDA creator</h1>
          <p className="mt-1 text-sm text-gray-600">
            Fill in the details and the agreement updates as you type. When it
            looks right, download it as a PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          Download PDF
        </button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[24rem_minmax(0,1fr)] print:block">
        <div className="print:hidden">
          <NdaForm data={data} onChange={update} onPartyChange={updateParty} />
        </div>
        <NdaDocument data={data} templates={templates} />
      </div>

      <p className="mt-6 text-xs text-gray-500 print:hidden">
        Choose “Save as PDF” as the destination in the print dialog. This tool
        produces a document from a template and is not legal advice.
      </p>
    </div>
  );
}
