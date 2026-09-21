import { expect, type Page } from "@playwright/test";
import type { NdaUpdates, PartyUpdate } from "@/lib/chat";

const noParty: PartyUpdate = { company: null, name: null, title: null, address: null };
const noUpdates: NdaUpdates = {
  purpose: null,
  effectiveDate: null,
  termType: null,
  termYears: null,
  confidentialityType: null,
  confidentialityYears: null,
  governingLaw: null,
  jurisdiction: null,
  modifications: null,
  party1: noParty,
  party2: noParty,
};

export type Updates = Partial<Omit<NdaUpdates, "party1" | "party2">> & {
  party1?: Partial<PartyUpdate>;
  party2?: Partial<PartyUpdate>;
};
type Reply = { reply: string; updates?: Updates } | { status: number; detail: string };

export type ChatRequest = {
  messages: { role: string; content: string }[];
  fields: NdaUpdates;
};

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
    const { party1, party2, ...rest } = next.updates ?? {};
    await route.fulfill({
      json: {
        reply: next.reply,
        updates: {
          ...noUpdates,
          ...rest,
          party1: { ...noParty, ...party1 },
          party2: { ...noParty, ...party2 },
        },
      },
    });
  });
  return requests;
}

/** Types a message in the chat, sends it, and waits for the assistant's reply to appear. */
export async function say(page: Page, message: string, expectedReply: string) {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log")).toContainText(expectedReply);
}

/** Every cover page field, as the assistant would fill them in one turn. */
export const EVERYTHING: Updates = {
  purpose: "Exploring a joint venture.",
  effectiveDate: "2027-01-05",
  governingLaw: "Delaware",
  jurisdiction: "New Castle, DE",
  modifications: "Section 3 is deleted.",
  party1: { company: "Acme Corp", name: "Jane Doe", title: "CEO", address: "jane@acme.com" },
  party2: { company: "Globex", name: "John Smith", title: "CFO", address: "1 Main St\nSpringfield" },
};
