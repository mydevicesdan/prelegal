import type { ChatReply, NdaUpdates, PartyUpdate } from "@/lib/chat";
import { vi } from "vitest";

export const noParty: PartyUpdate = { company: null, name: null, title: null, address: null };

export const noUpdates: NdaUpdates = {
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

export const chatReply = (reply: string, updates: Partial<NdaUpdates> = {}): ChatReply => ({
  reply,
  updates: { ...noUpdates, ...updates },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Replaces fetch with a mock returning the given replies in order (an Error rejects, a number is an HTTP status). */
export function mockChatApi(...responses: (ChatReply | Error | { status: number; body?: unknown })[]) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else if ("status" in r) fetchMock.mockResolvedValueOnce(json(r.body ?? {}, r.status));
    else fetchMock.mockResolvedValueOnce(json(r));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The parsed JSON body of the nth call to the mocked chat API. */
export const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(fetchMock.mock.calls[call][1].body as string);
