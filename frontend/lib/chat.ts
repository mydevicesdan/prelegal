import type { NdaFormData, NdaFormState, Party } from "@/lib/nda";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Party fields the assistant changed; null means unchanged (or, in a request, not set). */
export type PartyUpdate = { [K in keyof Party]: string | null };

/** Mirrors backend NdaFields: the wire format of the cover page fields. */
export interface NdaUpdates {
  purpose: string | null;
  effectiveDate: string | null;
  termType: NdaFormData["termType"] | null;
  termYears: number | null;
  confidentialityType: NdaFormData["confidentialityType"] | null;
  confidentialityYears: number | null;
  governingLaw: string | null;
  jurisdiction: string | null;
  modifications: string | null;
  party1: PartyUpdate;
  party2: PartyUpdate;
}

export interface ChatReply {
  reply: string;
  updates: NdaUpdates;
}

// Keep in step with the backend limits (backend/app/schemas.py).
export const MAX_TEXT_CHARS = 4000;
export const MAX_MESSAGES = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const orNull = (value: string): string | null => (value.trim() === "" ? null : value);

function yearsOrNull(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function partyToWire(party: Party): PartyUpdate {
  return {
    company: orNull(party.company),
    name: orNull(party.name),
    title: orNull(party.title),
    address: orNull(party.address),
  };
}

/** The current document as the assistant sees it: empty fields become null. */
export function toWireFields(data: NdaFormData): NdaUpdates {
  return {
    purpose: orNull(data.purpose),
    effectiveDate: orNull(data.effectiveDate),
    termType: data.termType,
    termYears: yearsOrNull(data.termYears),
    confidentialityType: data.confidentialityType,
    confidentialityYears: yearsOrNull(data.confidentialityYears),
    governingLaw: orNull(data.governingLaw),
    jurisdiction: orNull(data.jurisdiction),
    modifications: orNull(data.modifications),
    party1: partyToWire(data.party1),
    party2: partyToWire(data.party2),
  };
}

function mergeParty(party: Party, update: PartyUpdate): Party {
  return {
    company: update.company ?? party.company,
    name: update.name ?? party.name,
    title: update.title ?? party.title,
    address: update.address ?? party.address,
  };
}

/** Applies the assistant's changes. null leaves a field alone; values that don't make sense are ignored. */
export function applyUpdates(state: NdaFormState, updates: NdaUpdates): NdaFormState {
  const years = (value: number | null, current: string) =>
    value !== null && Number.isInteger(value) && value >= 1 ? String(value) : current;

  return {
    purpose: updates.purpose ?? state.purpose,
    effectiveDate:
      updates.effectiveDate && ISO_DATE.test(updates.effectiveDate)
        ? updates.effectiveDate
        : state.effectiveDate,
    termType: updates.termType ?? state.termType,
    termYears: years(updates.termYears, state.termYears),
    confidentialityType: updates.confidentialityType ?? state.confidentialityType,
    confidentialityYears: years(updates.confidentialityYears, state.confidentialityYears),
    governingLaw: updates.governingLaw ?? state.governingLaw,
    jurisdiction: updates.jurisdiction ?? state.jurisdiction,
    modifications: updates.modifications ?? state.modifications,
    party1: mergeParty(state.party1, updates.party1),
    party2: mergeParty(state.party2, updates.party2),
  };
}

/** Long sessions send only the most recent messages, so the conversation never outgrows the backend's limits. */
function withinLimits(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .slice(-MAX_MESSAGES)
    .map((m) => ({ ...m, content: m.content.slice(0, MAX_TEXT_CHARS) }));
}

/** One assistant turn. Throws an Error with a user-presentable message on failure. */
export async function sendChat(messages: ChatMessage[], data: NdaFormData): Promise<ChatReply> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: withinLimits(messages), fields: toWireFields(data) }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    if (typeof body?.detail === "string") throw new Error(body.detail);
    throw new Error(
      response.status === 422
        ? "That message could not be sent. Please shorten it and try again."
        : "Something went wrong. Please try again.",
    );
  }
  return (await response.json()) as ChatReply;
}
