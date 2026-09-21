"use client";

import { useEffect } from "react";

/** Shown above the agreement while working on it. */
export function DraftDisclaimer() {
  return (
    <div
      role="note"
      className="mb-4 rounded-md border border-amber-300 border-l-4 border-l-brand-yellow bg-amber-50 px-4 py-3 text-sm leading-relaxed text-gray-800 print:hidden"
    >
      <strong className="font-semibold text-brand-navy">Draft for review.</strong> This document is generated from a
      template and is not legal advice. Have a qualified lawyer review it before you sign or rely on it.
    </div>
  );
}

/** Repeated at the foot of every printed page: in the page margin where the browser supports that, else here. */
export function PrintDisclaimer() {
  useEffect(() => {
    if (!("CSSMarginRule" in window)) document.documentElement.classList.add("no-margin-boxes");
  }, []);
  return (
    <p className="print-disclaimer">
      Draft, subject to legal review. Not legal advice. Prepared with Prelegal.
    </p>
  );
}
