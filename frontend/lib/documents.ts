import type { Party } from "@/lib/nda";

/** The Mutual NDA has its own typed fields and layout; every other document is described by a DocumentSpec. */
export const NDA_KEY = "mutual-nda";
export const NDA_NAME = "Mutual Non-Disclosure Agreement";

export interface DocField {
  key: string;
  label: string;
  /** The page of the agreement the field belongs to: coverpage, orderform, sow, businessterms or keyterms. */
  source: string;
  /** The sentence of the terms where the field is used. */
  context: string;
}

/** Mirrors backend DocumentOut (GET /api/documents/{key}). */
export interface DocumentSpec {
  key: string;
  name: string;
  /** Party roles, e.g. Provider and Customer. */
  parties: string[];
  fields: DocField[];
  /** The standard terms as markdown, defined terms in bold. */
  terms: string;
}

/** What has been filled in for the generic documents. Shared by all of them: a field is identified by its key. */
export type FieldValues = Record<string, string>;
export type PartiesByRole = Record<string, Party>;

const SOURCES: { source: string; title: string }[] = [
  { source: "coverpage", title: "Cover Page" },
  { source: "orderform", title: "Order Form" },
  { source: "sow", title: "Statement of Work" },
  { source: "businessterms", title: "Business Terms" },
  { source: "keyterms", title: "Key Terms" },
];

export interface FieldGroup {
  title: string;
  fields: DocField[];
}

/** The document's fields grouped by the page they belong to, in reading order; empty groups are left out. */
export function groupFields(spec: DocumentSpec): FieldGroup[] {
  return SOURCES.map(({ source, title }) => ({
    title,
    fields: spec.fields.filter((f) => f.source === source),
  })).filter((group) => group.fields.length > 0);
}

export function progress(spec: DocumentSpec, values: FieldValues): { filled: number; total: number } {
  return {
    filled: spec.fields.filter((f) => (values[f.key] ?? "").trim() !== "").length,
    total: spec.fields.length,
  };
}

export const emptyParty: Party = { company: "", name: "", title: "", address: "" };

/** "Cloud Service Agreement - Acme - Globex": the name the PDF is saved under. */
export function documentTitle(spec: DocumentSpec, parties: PartiesByRole): string {
  const companies = spec.parties.map((role) => (parties[role]?.company ?? "").trim()).filter(Boolean);
  return [spec.name, ...companies].join(" - ");
}

/** Fetches the spec of a generic document. Throws an Error with a user-presentable message on failure. */
export async function fetchDocumentSpec(key: string): Promise<DocumentSpec> {
  let response: Response;
  try {
    response = await fetch(`/api/documents/${encodeURIComponent(key)}`);
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) throw new Error("Could not load the document. Please try again.");
  return (await response.json()) as DocumentSpec;
}
