import type { ChatReply, NdaUpdates } from "@/lib/chat";
import { NDA_KEY } from "@/lib/documents";
import { vi } from "vitest";
import { noUpdates, specFixtures } from "../fixtures";

export { csaSpec, noParty, noUpdates, slaSpec } from "../fixtures";

/** A turn that changes nothing but the reply, unless `patch` says otherwise. */
export const chatReply = (reply: string, patch: Partial<ChatReply> = {}): ChatReply => ({
  reply,
  documentType: null,
  updates: null,
  fieldValues: null,
  parties: null,
  ...patch,
});

/** A turn in a Mutual NDA conversation: the NDA is the active document and `updates` fill in some fields. */
export const ndaReply = (reply: string, updates: Partial<NdaUpdates> = {}): ChatReply =>
  chatReply(reply, { documentType: NDA_KEY, updates: { ...noUpdates, ...updates } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Scripted = ChatReply | Error | { status: number; body?: unknown };

/**
 * Replaces fetch with a mock of the backend. /api/chat answers with the given replies in order (an Error
 * rejects, an object with a status is an HTTP error); /api/documents/{key} serves specFixtures.
 */
export function mockChatApi(...replies: Scripted[]) {
  const queue = [...replies];
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/documents/")) {
      const spec = specFixtures[decodeURIComponent(String(url).split("/").pop()!)];
      return spec ? json(spec) : json({ detail: "Unknown document." }, 404);
    }
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected /api/chat call");
    if (next instanceof Error) throw next;
    if ("status" in next) return json(next.body ?? {}, next.status);
    return json(next);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The calls made to /api/chat (as opposed to /api/documents/*). */
const chatCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/chat");

/** The parsed JSON body of the nth call to /api/chat. */
export const requestBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(chatCalls(fetchMock)[call][1].body as string);

export const documentCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/documents/"));
