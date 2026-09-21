import { applyUpdates, type ChatReply, type PartyDetails } from "@/lib/chat";
import { emptyParty, type FieldValues, type PartiesByRole } from "@/lib/documents";
import { initialFormState, type NdaFormState } from "@/lib/nda";

/** Everything the user has told the assistant so far. */
export interface CreatorState {
  /** The active document (a catalog key), or null until one is chosen. */
  documentType: string | null;
  /** Mutual NDA fields. */
  nda: NdaFormState;
  /**
   * Values and party details of every other document. They are keyed by field key and party role rather than
   * by document, so switching between documents keeps what carries over (parties, governing law, dates...).
   */
  values: FieldValues;
  parties: PartiesByRole;
}

export const initialCreatorState: CreatorState = {
  documentType: null,
  nda: initialFormState,
  values: {},
  parties: {},
};

function mergeParties(parties: PartiesByRole, updates: PartyDetails[]): PartiesByRole {
  const merged = { ...parties };
  for (const { role, company, name, title, address } of updates) {
    const current = merged[role] ?? emptyParty;
    merged[role] = {
      company: company ?? current.company,
      name: name ?? current.name,
      title: title ?? current.title,
      address: address ?? current.address,
    };
  }
  return merged;
}

/** Applies one assistant turn. Anything the turn leaves null stays as it was. */
export function applyTurn(state: CreatorState, turn: ChatReply): CreatorState {
  const values = { ...state.values };
  for (const { key, value } of turn.fieldValues ?? []) values[key] = value;

  return {
    documentType: turn.documentType ?? state.documentType,
    nda: turn.updates ? applyUpdates(state.nda, turn.updates) : state.nda,
    values,
    parties: mergeParties(state.parties, turn.parties ?? []),
  };
}
