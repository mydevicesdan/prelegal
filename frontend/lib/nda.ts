export interface Party {
  company: string;
  name: string;
  title: string;
  address: string;
}

export interface NdaFormData {
  purpose: string;
  /** ISO date (yyyy-mm-dd), as produced by <input type="date">. */
  effectiveDate: string;
  termType: "expires" | "continues";
  termYears: string;
  confidentialityType: "years" | "perpetuity";
  confidentialityYears: string;
  governingLaw: string;
  jurisdiction: string;
  modifications: string;
  party1: Party;
  party2: Party;
}

/** Form state: `effectiveDate: null` means "not edited yet, use today's date". */
export type NdaFormState = Omit<NdaFormData, "effectiveDate"> & {
  effectiveDate: string | null;
};

const emptyParty: Party = { company: "", name: "", title: "", address: "" };

export const DEFAULT_PURPOSE =
  "Evaluating whether to enter into a business relationship with the other party.";

export const initialFormState: NdaFormState = {
  purpose: DEFAULT_PURPOSE,
  effectiveDate: null,
  termType: "expires",
  termYears: "1",
  confidentialityType: "years",
  confidentialityYears: "1",
  governingLaw: "",
  jurisdiction: "",
  modifications: "",
  party1: emptyParty,
  party2: emptyParty,
};

/** Today's date as yyyy-mm-dd in the user's local timezone. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "2026-09-19" -> "September 19, 2026" (no Date parsing, so no timezone shift). */
export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  const [, year, month, day] = match;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = months[Number(month) - 1];
  return monthName ? `${monthName} ${Number(day)}, ${year}` : "";
}

/** "1" -> "1 year(s)", matching the template's "[1 year(s)]" wording. */
export function formatYears(years: string): string {
  const n = Number.parseInt(years, 10);
  return `${Number.isFinite(n) && n > 0 ? n : 1} year(s)`;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!|<>~]/g, "\\$&");
}

/**
 * Prepares the Standard Terms markdown for rendering.
 *
 * The template marks references to the cover page as
 * `<span class="coverpage_link">Field</span>`. Governing Law and Jurisdiction
 * are filled in where they are first used (the clause reads naturally with the
 * value); every other reference, and later uses, stay as bold defined terms
 * pointing back to the cover page. User input is escaped so it cannot inject
 * markdown.
 */
export function fillStandardTerms(terms: string, data: NdaFormData): string {
  const fillable: Record<string, string> = {
    "Governing Law": data.governingLaw.trim(),
    Jurisdiction: data.jurisdiction.trim(),
  };
  const used = new Set<string>();

  return terms.replace(
    /<span class="coverpage_link">([^<]+)<\/span>/g,
    (_match, field: string) => {
      const value = fillable[field];
      if (value && !used.has(field)) {
        used.add(field);
        return `**${escapeMarkdown(value)}**`;
      }
      return `**${field}**`;
    },
  );
}
