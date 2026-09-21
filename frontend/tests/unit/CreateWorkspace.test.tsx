import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateWorkspace } from "@/components/CreateWorkspace";
import { loadMutualNdaTemplates, type MutualNdaTemplates } from "@/lib/templates";
import { chatReply, draftCalls, mockChatApi, type FakeBackend, type FakeDraft } from "./chatFixtures";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params }));

let templates: MutualNdaTemplates;
let backend: FakeBackend;

beforeAll(async () => {
  templates = await loadMutualNdaTemplates();
});

beforeEach(() => {
  nav.params = new URLSearchParams();
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  backend = mockChatApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const savedDraft = (id: number, overrides: Partial<FakeDraft> = {}): FakeDraft => ({
  id,
  documentType: "csa",
  documentName: "Cloud Service Agreement",
  companies: ["Acme Inc"],
  createdAt: "2026-09-01T10:00:00.000000Z",
  updatedAt: "2026-09-01T10:00:00.000000Z",
  state: {
    documentType: "csa",
    values: { "governing-law": "Delaware" },
    parties: { Provider: { company: "Acme Inc", name: "", title: "", address: "" } },
  },
  messages: [
    { role: "assistant", content: "Hello there." },
    { role: "user", content: "A CSA for Acme." },
    { role: "assistant", content: "Recorded the parties." },
  ],
  ...overrides,
});

const setup = () => render(<CreateWorkspace templates={templates} />);
const heading = () => document.querySelector("header h1") as HTMLElement;
const getCalls = () => draftCalls(backend).map((c) => c.request);

describe("a new document", () => {
  it("opens an empty editor straight away, without fetching anything", () => {
    setup();
    expect(heading()).toHaveTextContent("New document");
    expect(screen.getByRole("region", { name: "Chat with the assistant" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeEnabled();
    expect(getCalls()).toEqual([]);
  });

  it("starts over when asked for another new document", async () => {
    nav.params = new URLSearchParams("new=1");
    backend = mockChatApi(chatReply("First reply."));
    const user = userEvent.setup();
    const view = setup();
    await user.type(screen.getByLabelText("Message"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("First reply.");

    nav.params = new URLSearchParams("new=2");
    view.rerender(<CreateWorkspace templates={templates} />);
    expect(screen.queryByText("First reply.")).not.toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("What do you need?");
  });
});

describe("a saved document", () => {
  it("shows a loading state, then the restored conversation and document", async () => {
    backend.drafts.set(5, savedDraft(5));
    nav.params = new URLSearchParams("draft=5");
    setup();

    expect(screen.getByText("Opening your document…").closest("[role=status]")).toBeInTheDocument();
    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("Recorded the parties.");
    expect(heading()).toHaveTextContent("Cloud Service Agreement");
    expect(getCalls()).toEqual(["GET /api/drafts/5"]);
  });

  it("carries on with what was saved: the next turn saves to the same draft", async () => {
    backend.drafts.set(5, savedDraft(5));
    nav.params = new URLSearchParams("draft=5");
    const real = backend.getMockImplementation()!;
    const replies = [chatReply("Noted.", { documentType: "csa", fieldValues: [{ key: "chosen-courts", value: "Courts" }] })];
    backend.mockImplementation(async (url, init) => {
      if (url === "/api/chat") return new Response(JSON.stringify(replies.shift()), { status: 200 });
      return real(url, init);
    });
    const user = userEvent.setup();
    setup();
    await screen.findByRole("article", { name: "Cloud Service Agreement" });

    await user.type(screen.getByLabelText("Message"), "courts");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Noted.");
    await waitFor(() => expect(getCalls()).toContain("PUT /api/drafts/5"));
    expect(getCalls().filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("says when the document is not there, and points to My documents", async () => {
    nav.params = new URLSearchParams("draft=99");
    setup();
    expect(await screen.findByRole("heading", { name: "Document not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to My documents" })).toHaveAttribute("href", expect.stringMatching(/^\/documents\/?$/));
    expect(screen.getByRole("link", { name: "Start a new document" })).toBeInTheDocument();
  });

  it.each(["abc", "0", "-3", "1.5", "", "1e2", "0x10", "99999999999999999999"])("treats the address ?draft=%j as not found, without asking the server", async (bad) => {
    nav.params = new URLSearchParams({ draft: bad });
    setup();
    expect(await screen.findByRole("heading", { name: "Document not found" })).toBeInTheDocument();
    expect(getCalls()).toEqual([]);
  });

  it("says when it could not be opened, and opens it on retry", async () => {
    backend.drafts.set(5, savedDraft(5));
    backend.failNextDraftReads(1);
    nav.params = new URLSearchParams("draft=5");
    const user = userEvent.setup();
    setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem.");
    expect(screen.getByRole("link", { name: "Back to My documents" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
  });

  it("opens the other document when the address changes to it", async () => {
    backend.drafts.set(5, savedDraft(5));
    backend.drafts.set(6, savedDraft(6, { documentType: "sla", documentName: "Service Level Agreement", state: { documentType: "sla" } }));
    nav.params = new URLSearchParams("draft=5");
    const view = setup();
    await screen.findByRole("article", { name: "Cloud Service Agreement" });

    nav.params = new URLSearchParams("draft=6");
    view.rerender(<CreateWorkspace templates={templates} />);
    expect(await screen.findByRole("article", { name: "Service Level Agreement" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Cloud Service Agreement" })).not.toBeInTheDocument();
  });

  it("opens it afresh when the same draft is opened again", async () => {
    backend.drafts.set(5, savedDraft(5));
    nav.params = new URLSearchParams("draft=5");
    const view = setup();
    await screen.findByRole("article", { name: "Cloud Service Agreement" });

    nav.params = new URLSearchParams("draft=6");
    view.rerender(<CreateWorkspace templates={templates} />);
    await screen.findByRole("heading", { name: "Document not found" });
    nav.params = new URLSearchParams("draft=5");
    view.rerender(<CreateWorkspace templates={templates} />);
    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(getCalls().filter((c) => c === "GET /api/drafts/5")).toHaveLength(2);
  });
});

describe("coming back to a draft the editor was saving", () => {
  it("reopens the saved draft instead of mounting an empty editor at its address", async () => {
    backend = mockChatApi(chatReply("A CSA.", { documentType: "csa" }));
    const user = userEvent.setup();
    const view = setup();
    await user.type(screen.getByLabelText("Message"), "a csa");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Saved to My documents");
    nav.params = new URLSearchParams("draft=1"); // the editor moved the address to its draft
    view.rerender(<CreateWorkspace templates={templates} />);

    nav.params = new URLSearchParams("new=99"); // New document from the header
    view.rerender(<CreateWorkspace templates={templates} />);
    expect(screen.queryByText("A CSA.")).not.toBeInTheDocument();

    nav.params = new URLSearchParams("draft=1"); // the Back button
    view.rerender(<CreateWorkspace templates={templates} />);
    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("A CSA."); // restored from the saved draft
    expect(getCalls()).toEqual(["POST /api/drafts", "GET /api/drafts/1"]);
  });
});

describe("a document that is saved for the first time", () => {
  it("keeps the editor the user is in when the address moves to its new draft", async () => {
    backend = mockChatApi(chatReply("A CSA.", { documentType: "csa" }), chatReply("More."));
    const user = userEvent.setup();
    const view = setup();

    await user.type(screen.getByLabelText("Message"), "a csa");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Saved to My documents");
    expect(getCalls()).toEqual(["POST /api/drafts"]);

    // The editor has moved the address bar to ?draft=1; the page must not reload the draft it is editing.
    nav.params = new URLSearchParams("draft=1");
    view.rerender(<CreateWorkspace templates={templates} />);
    expect(screen.queryByText("Opening your document…")).not.toBeInTheDocument();
    expect(screen.getByRole("log")).toHaveTextContent("A CSA."); // the conversation is still there
    expect(getCalls()).toEqual(["POST /api/drafts"]); // and nothing was fetched

    // ...and it keeps saving to that draft.
    await user.type(screen.getByLabelText("Message"), "more");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("More.");
    await waitFor(() => expect(getCalls()).toEqual(["POST /api/drafts", "PUT /api/drafts/1"]));
  });
});
