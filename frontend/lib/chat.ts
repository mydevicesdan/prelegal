import { ApiError, api } from "@/lib/api";
import type { FieldValues, PartiesByRole } from "@/lib/documents";
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

/** A value for one field of a generic document. */
export interface FieldValue {
  key: string;
  value: string;
}

/** Details of one party of a generic document, by role. null means unknown (or, in a reply, unchanged). */
export type PartyDetails = { role: string } & PartyUpdate;

/**
 * Mirrors backend AiTurn. Which of `updates` (Mutual NDA) and `fieldValues` + `parties` (every other
 * document) is set depends on the active document; the rest are null.
 */
export interface ChatReply {
  reply: string;
  /** The document the user has chosen or switched to this turn; null if unchanged. */
  documentType: string | null;
  updates: NdaUpdates | null;
  fieldValues: FieldValue[] | null;
  parties: PartyDetails[] | null;
}

/** Everything the assistant needs to know about the document as it currently stands. */
export interface ChatContext {
  data: NdaFormData;
  documentType: string | null;
  values: FieldValues;
  parties: PartiesByRole;
}

// Keep in step with the backend limits (backend/app/schemas.py).
export const MAX_TEXT_CHARS = 4000;
export const MAX_MESSAGES = 50;
export const MAX_FIELD_VALUES = 100;
export const MAX_PARTIES = 4;

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

/** State that has built up over several documents can outgrow the request limits: send what fits. */
function valuesToWire(values: FieldValues): FieldValue[] {
  return Object.entries(values)
    .filter(([, value]) => value.trim() !== "")
    .slice(0, MAX_FIELD_VALUES)
    .map(([key, value]) => ({ key, value: value.slice(0, MAX_TEXT_CHARS) }));
}

function partiesToWire(parties: PartiesByRole): PartyDetails[] {
  return Object.entries(parties)
    .map(([role, party]) => ({ role, ...partyToWire(party) }))
    .filter((party) => party.company || party.name || party.title || party.address)
    .slice(0, MAX_PARTIES);
}

/** One assistant turn. Throws an Error with a user-presentable message on failure. */
export async function sendChat(messages: ChatMessage[], context: ChatContext): Promise<ChatReply> {
  try {
    return await api<ChatReply>("/api/chat", {
      method: "POST",
      body: {
        messages: withinLimits(messages),
        fields: toWireFields(context.data),
        documentType: context.documentType,
        values: valuesToWire(context.values),
        parties: partiesToWire(context.parties),
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      throw new Error("That message could not be sent. Please shorten it and try again.");
    }
    throw error;
  }
}
