import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/chat";
import { initialCreatorState, type CreatorState } from "@/lib/creator";
import { NDA_KEY, type DocumentSpec, type PartiesByRole } from "@/lib/documents";
import { initialFormState, todayIso, type NdaFormState, type Party } from "@/lib/nda";

/** What the list shows about a saved draft. */
export interface DraftSummary {
  id: number;
  documentType: string;
  documentName: string;
  companies: string[];
  createdAt: string;
  updatedAt: string;
}

/** A saved draft in full. `state` is what the editor saved; it is checked by `parseCreatorState` before use. */
export interface Draft extends DraftSummary {
  state: unknown;
  messages: ChatMessage[];
}

/** What is sent to save a draft. */
export interface DraftPayload {
  documentType: string;
  companies: string[];
  state: CreatorState;
  messages: ChatMessage[];
}

// Keep in step with the backend limits (backend/app/drafts_api.py): a draft over them is refused for good.
export const MAX_STORED_MESSAGES = 200;
export const MAX_STORED_TEXT = 4000;
export const MAX_COMPANIES = 4;
export const MAX_COMPANY_CHARS = 200;

export const listDrafts = () => api<DraftSummary[]>("/api/drafts");
export const getDraft = (id: number) => api<Draft>(`/api/drafts/${id}`);
export const createDraft = (payload: DraftPayload) => api<Draft>("/api/drafts", { method: "POST", body: payload });
export const saveDraft = (id: number, payload: DraftPayload) =>
  api<Draft>(`/api/drafts/${id}`, { method: "PUT", body: payload });
export const deleteDraft = (id: number) => api(`/api/drafts/${id}`, { method: "DELETE" });

/**
 * The party companies shown in the list. The document's spec gives the roles in reading order; while it is
 * still loading, whichever parties have been named will do (the next save corrects it).
 */
export function draftCompanies(state: CreatorState, spec?: DocumentSpec): string[] {
  const clean = (names: string[]) =>
    names
      .map((name) => name.trim().slice(0, MAX_COMPANY_CHARS))
      .filter(Boolean)
      .slice(0, MAX_COMPANIES);
  if (state.documentType === NDA_KEY) return clean([state.nda.party1.company, state.nda.party2.company]);
  const roles = spec?.parties ?? Object.keys(state.parties);
  return clean(roles.map((role) => state.parties[role]?.company ?? ""));
}

/**
 * What is sent to save a draft. A very long conversation keeps its most recent messages, and an NDA nobody gave
 * a date is dated the day it was drafted, so it does not change date each time it is opened.
 */
export function toDraftPayload(
  state: CreatorState,
  messages: ChatMessage[],
  spec?: DocumentSpec,
  today: string = todayIso(),
): DraftPayload {
  const saved =
    state.documentType === NDA_KEY && state.nda.effectiveDate === null
      ? { ...state, nda: { ...state.nda, effectiveDate: today } }
      : state;
  return {
    documentType: state.documentType!,
    companies: draftCompanies(state, spec),
    state: saved,
    messages: messages
      .slice(-MAX_STORED_MESSAGES)
      .map((m) => ({ ...m, content: m.content.slice(0, MAX_STORED_TEXT) })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

function parseParty(raw: unknown): Party {
  const record = isRecord(raw) ? raw : {};
  return {
    company: str(record.company),
    name: str(record.name),
    title: str(record.title),
    address: str(record.address),
  };
}

function parseNda(raw: unknown): NdaFormState {
  const record = isRecord(raw) ? raw : {};
  const initial = initialFormState;
  return {
    purpose: str(record.purpose, initial.purpose),
    effectiveDate: typeof record.effectiveDate === "string" ? record.effectiveDate : null,
    termType: record.termType === "continues" ? "continues" : "expires",
    termYears: str(record.termYears, initial.termYears),
    confidentialityType: record.confidentialityType === "perpetuity" ? "perpetuity" : "years",
    confidentialityYears: str(record.confidentialityYears, initial.confidentialityYears),
    governingLaw: str(record.governingLaw),
    jurisdiction: str(record.jurisdiction),
    modifications: str(record.modifications),
    party1: parseParty(record.party1),
    party2: parseParty(record.party2),
  };
}

/** Turns whatever was stored into a valid editor state: unknown or malformed parts fall back to blank. */
export function parseCreatorState(raw: unknown): CreatorState {
  if (!isRecord(raw)) return initialCreatorState;
  const values: Record<string, string> = {};
  if (isRecord(raw.values)) {
    for (const [key, value] of Object.entries(raw.values)) if (typeof value === "string") values[key] = value;
  }
  const parties: PartiesByRole = {};
  if (isRecord(raw.parties)) {
    for (const [role, party] of Object.entries(raw.parties)) parties[role] = parseParty(party);
  }
  return {
    documentType: typeof raw.documentType === "string" ? raw.documentType : null,
    nda: parseNda(raw.nda),
    values,
    parties,
  };
}

/** The stored conversation, keeping only well-formed messages. */
export function parseMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ChatMessage[] =>
    isRecord(item) && (item.role === "user" || item.role === "assistant") && typeof item.content === "string"
      ? [{ role: item.role, content: item.content }]
      : [],
  );
}
