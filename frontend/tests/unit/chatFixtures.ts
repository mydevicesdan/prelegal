import type { ChatReply, NdaUpdates } from "@/lib/chat";
import { NDA_KEY, NDA_NAME } from "@/lib/documents";
import { vi, type Mock } from "vitest";
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

export const TEST_USER = { id: 1, name: "Ada Lovelace", email: "ada@example.com" };
/** The password the fake accepts for sign-in, and an email it says is already registered. */
export const TEST_PASSWORD = "correct horse battery";
export const TAKEN_EMAIL = "taken@example.com";

/** A saved draft as the backend would hold it. */
export interface FakeDraft {
  id: number;
  documentType: string;
  documentName: string;
  companies: string[];
  createdAt: string;
  updatedAt: string;
  state: unknown;
  messages: { role: string; content: string }[];
}

const nameOf = (type: string) => (type === NDA_KEY ? NDA_NAME : (specFixtures[type]?.name ?? type));

export type FakeBackend = Mock<(url: string, init?: RequestInit) => Promise<Response>> & {
  /** The drafts the fake holds, by id. */
  drafts: Map<number, FakeDraft>;
  /** Makes the next `count` draft writes fail (a status, or a rejected fetch when `status` is 0). */
  failNextDraftWrites: (count: number, status?: number) => void;
  /** Makes the next `count` draft reads or listings fail. */
  failNextDraftReads: (count: number, status?: number) => void;
  /** Who /api/auth/session says is signed in (null: nobody). */
  signedInAs: { id: number; name: string; email: string } | null;
};

/** Anything with a recorded call list: a vi.fn(), or the fake backend. */
type Recorded = { mock: { calls: unknown[][] } };

/**
 * Replaces fetch with a small in-memory fake of the backend:
 * /api/chat answers with the given replies in order (an Error rejects, an object with a status is an HTTP error),
 * /api/documents/{key} serves specFixtures, /api/drafts keeps drafts, /api/auth/session says who is signed in.
 */
export function mockChatApi(...replies: Scripted[]): FakeBackend {
  const queue = [...replies];
  const drafts = new Map<number, FakeDraft>();
  let nextId = 1;
  let writeFailures: { count: number; status: number } | null = null;
  let readFailures: { count: number; status: number } | null = null;

  const failure = (slot: typeof writeFailures) => {
    if (!slot || slot.count <= 0) return null;
    slot.count -= 1;
    if (slot.status === 0) throw new TypeError("Failed to fetch");
    return json({ detail: "The server had a problem." }, slot.status);
  };

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    if (path === "/api/auth/session") return json({ user: fetchMock.signedInAs });
    if (path === "/api/auth/login") {
      if (body.password !== TEST_PASSWORD) return json({ detail: "Incorrect email or password." }, 401);
      fetchMock.signedInAs = TEST_USER;
      return json(TEST_USER);
    }
    if (path === "/api/auth/signup") {
      if (body.email === TAKEN_EMAIL) {
        return json({ detail: "An account with this email already exists. Try signing in instead." }, 409);
      }
      fetchMock.signedInAs = { id: 1, name: body.name, email: body.email };
      return json(fetchMock.signedInAs, 201);
    }
    if (path === "/api/auth/logout") {
      fetchMock.signedInAs = null;
      return new Response(null, { status: 204 });
    }

    if (path.startsWith("/api/documents/")) {
      const spec = specFixtures[decodeURIComponent(path.split("/").pop()!)];
      return spec ? json(spec) : json({ detail: "Unknown document." }, 404);
    }

    if (path === "/api/drafts" || path.startsWith("/api/drafts/")) {
      const id = path === "/api/drafts" ? null : Number(path.split("/").pop());
      const writing = method !== "GET";
      const failed = failure(writing ? writeFailures : readFailures);
      if (failed) return failed;

      if (id === null && method === "POST") {
        const now = new Date().toISOString();
        const draft: FakeDraft = {
          id: nextId++,
          documentType: body.documentType,
          documentName: nameOf(body.documentType),
          companies: body.companies,
          createdAt: now,
          updatedAt: now,
          state: body.state,
          messages: body.messages,
        };
        drafts.set(draft.id, draft);
        return json(draft, 201);
      }
      if (id === null) {
        const summaries = [...drafts.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
          .map((draft) => ({
            id: draft.id,
            documentType: draft.documentType,
            documentName: draft.documentName,
            companies: draft.companies,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt,
          }));
        return json(summaries);
      }
      const draft = drafts.get(id);
      if (!draft) return json({ detail: "Document not found." }, 404);
      if (method === "DELETE") {
        drafts.delete(id);
        return new Response(null, { status: 204 });
      }
      if (method === "PUT") {
        Object.assign(draft, {
          documentType: body.documentType,
          documentName: nameOf(body.documentType),
          companies: body.companies,
          state: body.state,
          messages: body.messages,
          updatedAt: new Date().toISOString(),
        });
      }
      return json(draft);
    }

    if (path === "/api/chat") {
      const next = queue.shift();
      if (next === undefined) throw new Error("unexpected /api/chat call");
      if (next instanceof Error) throw next;
      if ("status" in next) return json(next.body ?? {}, next.status);
      return json(next);
    }

    throw new Error(`unexpected request: ${method} ${path}`);
  }) as unknown as FakeBackend;

  fetchMock.drafts = drafts;
  fetchMock.signedInAs = TEST_USER;
  fetchMock.failNextDraftWrites = (count, status = 500) => {
    writeFailures = { count, status };
  };
  fetchMock.failNextDraftReads = (count, status = 500) => {
    readFailures = { count, status };
  };
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callsTo = (fetchMock: Recorded, prefix: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === prefix || String(url).startsWith(prefix + "/"));

/** The parsed JSON body of the nth call to /api/chat. */
export const requestBody = (fetchMock: Recorded, call = 0) =>
  JSON.parse((callsTo(fetchMock, "/api/chat")[call]![1] as RequestInit).body as string);

export const documentCalls = (fetchMock: Recorded) =>
  callsTo(fetchMock, "/api/documents").map(([url]) => String(url));

/** Every call to /api/drafts, as "METHOD path" with the parsed body. */
export const draftCalls = (fetchMock: Recorded) =>
  callsTo(fetchMock, "/api/drafts").map(([url, init]) => ({
    request: `${(init as RequestInit | undefined)?.method ?? "GET"} ${String(url)}`,
    body: typeof (init as RequestInit | undefined)?.body === "string" ? JSON.parse((init as RequestInit).body as string) : undefined,
  }));
