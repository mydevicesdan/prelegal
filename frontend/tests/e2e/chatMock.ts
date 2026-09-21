import { expect, type Page } from "@playwright/test";
import type { NdaUpdates, PartyUpdate } from "@/lib/chat";
import { NDA_KEY } from "@/lib/documents";
import { noParty, noUpdates } from "../fixtures";

export type Updates = Partial<Omit<NdaUpdates, "party1" | "party2">> & {
  party1?: Partial<PartyUpdate>;
  party2?: Partial<PartyUpdate>;
};

type Turn = {
  reply: string;
  documentType?: string;
  /** Mutual NDA fields. */
  updates?: Updates;
  /** Every other document: field values by key, and party details by role. */
  fieldValues?: Record<string, string>;
  parties?: Record<string, Partial<PartyUpdate>>;
};
type Reply = Turn | { status: number; detail: string };

export type ChatRequest = {
  messages: { role: string; content: string }[];
  fields: NdaUpdates;
  documentType: string | null;
  values: { key: string; value: string }[];
  parties: ({ role: string } & PartyUpdate)[];
};

function toWire(turn: Turn) {
  const { party1, party2, ...rest } = turn.updates ?? {};
  return {
    reply: turn.reply,
    documentType: turn.documentType ?? null,
    updates: turn.updates
      ? { ...noUpdates, ...rest, party1: { ...noParty, ...party1 }, party2: { ...noParty, ...party2 } }
      : null,
    fieldValues: turn.fieldValues
      ? Object.entries(turn.fieldValues).map(([key, value]) => ({ key, value }))
      : null,
    parties: turn.parties
      ? Object.entries(turn.parties).map(([role, details]) => ({ role, ...noParty, ...details }))
      : null,
  };
}

/**
 * Stands in for the backend's /api/chat (the e2e server only serves the static export).
 * Replies are returned in order, the last one repeating. Returns the requests seen so far.
 */
export async function mockChat(page: Page, ...replies: Reply[]): Promise<ChatRequest[]> {
  const requests: ChatRequest[] = [];
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    const next = replies[Math.min(requests.length, replies.length) - 1] ?? { reply: "Noted." };
    if ("status" in next) {
      await route.fulfill({ status: next.status, json: { detail: next.detail } });
      return;
    }
    await route.fulfill({ json: toWire(next) });
  });
  return requests;
}

/** Types a message in the chat, sends it, and waits for the assistant's reply to appear. */
export async function say(page: Page, message: string, expectedReply: string) {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log")).toContainText(expectedReply);
}

/** Every Mutual NDA field, as the assistant would fill them in one turn. */
export const EVERYTHING: Updates = {
  purpose: "Exploring a joint venture.",
  effectiveDate: "2027-01-05",
  governingLaw: "Delaware",
  jurisdiction: "New Castle, DE",
  modifications: "Section 3 is deleted.",
  party1: { company: "Acme Corp", name: "Jane Doe", title: "CEO", address: "jane@acme.com" },
  party2: { company: "Globex", name: "John Smith", title: "CFO", address: "1 Main St\nSpringfield" },
};

/** Every field and party of the Cloud Service Agreement fixture, in one turn. */
export const CSA_EVERYTHING: Turn = {
  reply: "All filled in.",
  documentType: "csa",
  fieldValues: {
    "subscription-period": "12 months from the Order Date",
    "governing-law": "Delaware",
    "chosen-courts": "The state courts in New Castle County",
  },
  parties: {
    Provider: { company: "Acme Inc", name: "Jane Doe", title: "CEO", address: "jane@acme.com" },
    Customer: { company: "Globex LLC", name: "John Smith", title: "CFO", address: "1 Main St\nSpringfield" },
  },
};

export { NDA_KEY };
