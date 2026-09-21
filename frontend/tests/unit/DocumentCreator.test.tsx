import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentCreator, type EditorSession } from "@/components/DocumentCreator";
import { initialCreatorState } from "@/lib/creator";
import { loadMutualNdaTemplates, type MutualNdaTemplates } from "@/lib/templates";
import { chatReply, documentCalls, draftCalls, mockChatApi, ndaReply, noParty, requestBody } from "./chatFixtures";

let templates: MutualNdaTemplates;

beforeAll(async () => {
  templates = await loadMutualNdaTemplates();
});

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Freeze only Date so userEvent's timers keep working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 19, 12, 0));
  replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setup = (options: { session?: EditorSession; onDraftId?: (id: number) => void } = {}) => {
  const user = userEvent.setup();
  render(<DocumentCreator templates={templates} {...options} />);
  return user;
};

const doc = () => screen.getByRole("article");
const section = (heading: string) =>
  within(doc()).getByRole("heading", { name: heading }).closest("section") as HTMLElement;
const download = () => screen.getByRole("button", { name: "Download PDF" });
// The page's own title (the agreement on the paper has an h1 of its own too).
const pageHeading = () => document.querySelector("header h1") as HTMLElement;

async function say(user: ReturnType<typeof userEvent.setup>, message: string, reply: string) {
  await user.type(screen.getByLabelText("Message"), message);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(reply);
}

const saved = () => screen.findByText("Saved to My documents");

const csaTurn = (reply: string, extra: Partial<Parameters<typeof chatReply>[1]> = {}) =>
  chatReply(reply, { documentType: "csa", ...extra });

describe("before a document is chosen", () => {
  it("shows the chat and an empty preview, with nothing to download or save", () => {
    const backend = mockChatApi();
    setup();
    expect(pageHeading()).toHaveTextContent("New document");
    expect(screen.getByRole("region", { name: "Chat with the assistant" })).toBeInTheDocument();
    expect(screen.getByText(/Your document will appear here/)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(download()).toBeDisabled();
    expect(draftCalls(backend)).toEqual([]);
  });

  it("stays empty, and saves nothing, when the assistant declines an unsupported request", async () => {
    const reply = "Sorry, I can't draft an employment agreement. The closest is the NDA.";
    const backend = mockChatApi(chatReply(reply));
    const user = setup();
    await say(user, "I need an employment agreement", reply);

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(download()).toBeDisabled();
    expect(documentCalls(backend)).toEqual([]);
    expect(draftCalls(backend)).toEqual([]);
    expect(screen.queryByText(/Saved to My documents/)).not.toBeInTheDocument();
  });
});

describe("Mutual NDA", () => {
  it("shows the NDA as soon as the assistant chooses it, with today's effective date and the draft notice", async () => {
    mockChatApi(ndaReply("An NDA. Who are the parties?"));
    const user = setup();
    await say(user, "an NDA please", "An NDA. Who are the parties?");

    expect(pageHeading()).toHaveTextContent("Mutual Non-Disclosure Agreement");
    expect(within(doc()).getByRole("heading", { name: "Standard Terms" })).toBeInTheDocument();
    expect(section("Effective Date")).toHaveTextContent("September 19, 2026");
    expect(download()).toBeEnabled();
    expect(screen.getByRole("note")).toHaveTextContent("Draft for review");
    expect(screen.getByRole("note")).toHaveTextContent("not legal advice");
    expect(document.querySelector(".print-disclaimer")).toHaveTextContent("Draft, subject to legal review");
  });

  it("does not tell the assistant a date nobody chose", async () => {
    const backend = mockChatApi(ndaReply("ok"), ndaReply("ok2"));
    const user = setup();
    await say(user, "an NDA", "ok");
    await say(user, "more", "ok2");
    expect(requestBody(backend, 0).fields.effectiveDate).toBeNull();
    expect(requestBody(backend, 1).fields.effectiveDate).toBeNull();
  });

  it("fills the agreement in from the assistant's updates and across turns", async () => {
    const backend = mockChatApi(
      ndaReply("Recorded. Who signs for Globex?", {
        purpose: "Exploring a joint venture.",
        governingLaw: "Delaware",
        jurisdiction: "New Castle, DE",
        termType: "continues",
        confidentialityType: "perpetuity",
        party1: { ...noParty, company: "Acme Corp", name: "Jane Doe" },
        party2: { ...noParty, company: "Globex" },
      }),
      ndaReply("Thanks", { modifications: "Section 3 is deleted." }),
    );
    const user = setup();
    await say(user, "Acme and Globex, Delaware", "Recorded. Who signs for Globex?");

    expect(section("Purpose")).toHaveTextContent("Exploring a joint venture.");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Governing Law: Delaware");
    expect(doc()).toHaveTextContent("courts located in New Castle, DE. Each party");
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Continues/);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*In\ perpetuity\./);
    expect(doc()).toHaveTextContent("Jane Doe");

    await say(user, "and a modification", "Thanks");
    expect(section("MNDA Modifications")).toHaveTextContent("Section 3 is deleted.");
    expect(doc()).toHaveTextContent("Governing Law: Delaware");
    const second = requestBody(backend, 1);
    expect(second.documentType).toBe("mutual-nda");
    expect(second.fields.party1.company).toBe("Acme Corp");
  });
});

describe("other documents", () => {
  it("loads the chosen document once and shows its generated front page", async () => {
    const backend = mockChatApi(csaTurn("A CSA. Who are the parties?"), csaTurn("Thanks."));
    const user = setup();
    await say(user, "a SaaS agreement", "A CSA. Who are the parties?");

    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(pageHeading()).toHaveTextContent("Cloud Service Agreement");
    expect(section("Order Form")).toHaveTextContent("Subscription Period: [Subscription Period]");
    expect(download()).toBeEnabled();
    expect(screen.getByRole("note")).toHaveTextContent("Draft for review");

    await say(user, "more", "Thanks.");
    expect(documentCalls(backend)).toEqual(["/api/documents/csa"]);
  });

  it("fills in values and party details as the assistant learns them, and shows the progress", async () => {
    const backend = mockChatApi(
      csaTurn("Recorded.", {
        fieldValues: [
          { key: "governing-law", value: "Delaware" },
          { key: "subscription-period", value: "12 months" },
        ],
        parties: [
          { role: "Provider", ...noParty, company: "Acme Inc", name: "Jane Doe", title: "CEO" },
          { role: "Customer", ...noParty, company: "Globex LLC" },
        ],
      }),
      csaTurn("Thanks.", { fieldValues: [{ key: "chosen-courts", value: "New Castle County courts" }] }),
    );
    const user = setup();
    await say(user, "Acme sells to Globex, Delaware law, 12 months", "Recorded.");

    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    expect(section("Parties")).toHaveTextContent("Provider: Acme Inc");
    expect(section("Parties")).toHaveTextContent("Customer: Globex LLC");
    expect(section("Key Terms")).toHaveTextContent("Governing Law: Delaware");
    expect(section("Order Form")).toHaveTextContent("Subscription Period: 12 months");
    expect(screen.getByText("2 of 3 details filled in")).toBeInTheDocument();
    const meter = screen.getByRole("progressbar", { name: "Details filled in" });
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect(meter).toHaveAttribute("aria-valuemax", "3");

    await say(user, "courts?", "Thanks.");
    expect(screen.getByText("3 of 3 details filled in")).toBeInTheDocument();
    // The assistant is told everything that has been filled in so far.
    const body = requestBody(backend, 1);
    expect(body.documentType).toBe("csa");
    expect(body.values).toEqual(
      expect.arrayContaining([
        { key: "governing-law", value: "Delaware" },
        { key: "subscription-period", value: "12 months" },
      ]),
    );
    expect(body.parties).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "Provider", company: "Acme Inc", title: "CEO" })]),
    );
  });

  it("only tells the assistant about the active document, however much is left over from earlier ones", async () => {
    const backend = mockChatApi(
      csaTurn("Recorded.", {
        fieldValues: [
          { key: "governing-law", value: "Delaware" },
          { key: "left-over-from-another-document", value: "x" },
        ],
        parties: [
          { role: "Provider", ...noParty, company: "Acme Inc" },
          { role: "Partner", ...noParty, company: "Left Over Ltd" },
        ],
      }),
      csaTurn("Thanks."),
    );
    const user = setup();
    await say(user, "one", "Recorded.");
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    await say(user, "two", "Thanks.");

    const body = requestBody(backend, 1);
    expect(body.values).toEqual([{ key: "governing-law", value: "Delaware" }]);
    expect(body.parties.map((p: { role: string }) => p.role)).toEqual(["Provider"]);
  });

  it("keeps what carries over when the assistant switches to another document, and loads it", async () => {
    const backend = mockChatApi(
      csaTurn("Recorded.", {
        fieldValues: [
          { key: "subscription-period", value: "12 months" },
          { key: "governing-law", value: "Delaware" },
        ],
        parties: [{ role: "Provider", ...noParty, company: "Acme Inc" }],
      }),
      chatReply("An SLA too.", { documentType: "sla" }),
    );
    const user = setup();
    await say(user, "csa", "Recorded.");
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    await say(user, "also an SLA", "An SLA too.");

    expect(await screen.findByRole("article", { name: "Service Level Agreement" })).toBeInTheDocument();
    expect(section("Parties")).toHaveTextContent("Provider: Acme Inc");
    expect(section("Order Form")).toHaveTextContent("Subscription Period: 12 months");
    expect(section("Order Form")).toHaveTextContent("Target Uptime: [Target Uptime]");
    expect(documentCalls(backend)).toEqual(["/api/documents/csa", "/api/documents/sla"]);
  });

  it("goes back to a document without loading it again, with its values intact", async () => {
    const backend = mockChatApi(
      csaTurn("CSA.", { fieldValues: [{ key: "governing-law", value: "Delaware" }] }),
      chatReply("SLA.", { documentType: "sla" }),
      chatReply("Back to the CSA.", { documentType: "csa" }),
    );
    const user = setup();
    await say(user, "csa", "CSA.");
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    await say(user, "sla", "SLA.");
    await screen.findByRole("article", { name: "Service Level Agreement" });
    await say(user, "csa again", "Back to the CSA.");

    expect(screen.getByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(section("Key Terms")).toHaveTextContent("Governing Law: Delaware");
    expect(documentCalls(backend)).toEqual(["/api/documents/csa", "/api/documents/sla"]);
  });

  it("shows the NDA and then another document, without mixing their details up", async () => {
    mockChatApi(
      ndaReply("NDA.", { governingLaw: "Ohio" }),
      csaTurn("CSA.", { fieldValues: [{ key: "governing-law", value: "Delaware" }] }),
    );
    const user = setup();
    await say(user, "nda", "NDA.");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Governing Law: Ohio");
    await say(user, "csa", "CSA.");

    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    expect(doc()).not.toHaveTextContent("Ohio");
    expect(section("Key Terms")).toHaveTextContent("Governing Law: Delaware");
  });

  it("says so when the document cannot be loaded, and loads it on retry", async () => {
    const backend = mockChatApi(csaTurn("A CSA."));
    const real = backend.getMockImplementation()!;
    let outage = true; // lasts until the user retries
    backend.mockImplementation(async (url, init) => {
      if (String(url).startsWith("/api/documents/") && outage) throw new TypeError("Failed to fetch");
      return real(url, init);
    });
    const user = setup();
    await say(user, "a csa", "A CSA.");

    expect(await screen.findByRole("alert", { name: "" })).toHaveTextContent("Could not reach the server");
    expect(download()).toBeDisabled();
    outage = false;
    await user.click(screen.getByRole("button", { name: "Try loading it again" }));

    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(download()).toBeEnabled();
  });

  it("shows a loading message while the document loads", async () => {
    const backend = mockChatApi(csaTurn("A CSA."));
    const real = backend.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    backend.mockImplementation(async (url, init) => {
      if (String(url).startsWith("/api/documents/")) await gate;
      return real(url, init);
    });
    const user = setup();
    await say(user, "a csa", "A CSA.");

    expect(screen.getByText("Loading the document…").closest("[role=status]")).toBeInTheDocument();
    expect(download()).toBeDisabled();
    release();
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    expect(screen.queryByText("Loading the document…")).not.toBeInTheDocument();
  });

  it("leaves the preview alone when a chat request fails", async () => {
    mockChatApi(csaTurn("A CSA."), { status: 502, body: { detail: "The AI assistant could not respond." } });
    const user = setup();
    await say(user, "a csa", "A CSA.");
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    await user.type(screen.getByLabelText("Message"), "more");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("The AI assistant could not respond.");
    expect(screen.getByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("saves a draft after the first turn that chooses a document, and follows it in the address bar", async () => {
    const onDraftId = vi.fn();
    const backend = mockChatApi(
      csaTurn("A CSA.", { parties: [{ role: "Provider", ...noParty, company: "Acme Inc" }] }),
    );
    const user = setup({ onDraftId });
    await say(user, "a csa for Acme", "A CSA.");
    await saved();

    const [create] = draftCalls(backend);
    expect(create!.request).toBe("POST /api/drafts");
    expect(create!.body).toMatchObject({
      documentType: "csa",
      companies: ["Acme Inc"],
      state: { documentType: "csa", parties: { Provider: { company: "Acme Inc" } } },
    });
    // The whole conversation goes with it, greeting included.
    expect(create!.body.messages.map((m: { role: string }) => m.role)).toEqual(["assistant", "user", "assistant"]);
    expect(create!.body.messages[2].content).toBe("A CSA.");
    expect(onDraftId).toHaveBeenCalledWith(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/create/?draft=1");
    expect([...backend.drafts.keys()]).toEqual([1]);
  });

  it("saves later turns to the same draft rather than creating another", async () => {
    const backend = mockChatApi(
      csaTurn("First."),
      csaTurn("Second.", { fieldValues: [{ key: "governing-law", value: "Ohio" }] }),
    );
    const user = setup();
    await say(user, "one", "First.");
    await saved();
    await say(user, "two", "Second.");
    await waitFor(() => expect(draftCalls(backend).map((c) => c.request)).toEqual(["POST /api/drafts", "PUT /api/drafts/1"]));

    const [, update] = draftCalls(backend);
    expect(update!.body.state.values).toEqual({ "governing-law": "Ohio" });
    expect(update!.body.messages).toHaveLength(5);
    expect([...backend.drafts.keys()]).toEqual([1]);
  });

  it("names the parties in the order the document lists them, even on the very first save", async () => {
    const backend = mockChatApi(
      csaTurn("First.", { parties: [{ role: "Provider", ...noParty, company: "Acme" }, { role: "Customer", ...noParty, company: "Globex" }] }),
    );
    const user = setup();
    await say(user, "one", "First.");
    await saved();
    // The save waited for the document's details, which say the CSA lists the Customer first.
    expect(draftCalls(backend)[0]!.body.companies).toEqual(["Globex", "Acme"]);
    expect(documentCalls(backend)).toEqual(["/api/documents/csa"]); // and shared the preview's request
  });

  it("still saves, with the parties as named, when the document's details cannot be loaded", async () => {
    const backend = mockChatApi(
      csaTurn("First.", { parties: [{ role: "Provider", ...noParty, company: "Acme" }, { role: "Customer", ...noParty, company: "Globex" }] }),
    );
    const real = backend.getMockImplementation()!;
    backend.mockImplementation(async (url, init) => {
      if (String(url).startsWith("/api/documents/")) throw new TypeError("Failed to fetch");
      return real(url, init);
    });
    const user = setup();
    await say(user, "one", "First.");
    await saved();
    expect(draftCalls(backend)[0]!.body.companies).toEqual(["Acme", "Globex"]);
  });

  it("saves the Mutual NDA with its two companies", async () => {
    const backend = mockChatApi(
      ndaReply("ok", { party1: { ...noParty, company: "Acme" }, party2: { ...noParty, company: "Globex" } }),
    );
    const user = setup();
    await say(user, "nda", "ok");
    await saved();
    expect(draftCalls(backend)[0]!.body).toMatchObject({ documentType: "mutual-nda", companies: ["Acme", "Globex"] });
  });

  it("starts a new draft when the assistant switches to another document, leaving the first as it was", async () => {
    const onDraftId = vi.fn();
    const backend = mockChatApi(
      csaTurn("CSA.", { fieldValues: [{ key: "governing-law", value: "Delaware" }] }),
      chatReply("SLA too.", { documentType: "sla" }),
    );
    const user = setup({ onDraftId });
    await say(user, "csa", "CSA.");
    await saved();
    await say(user, "and an sla", "SLA too.");
    await waitFor(() => expect(backend.drafts.size).toBe(2));

    const [first, second] = [...backend.drafts.values()];
    expect(first!.documentType).toBe("csa");
    expect((first!.state as { values: object }).values).toEqual({ "governing-law": "Delaware" });
    expect(first!.messages).toHaveLength(3); // as it was when it was left
    expect(second!.documentType).toBe("sla");
    expect((second!.state as { values: object }).values).toEqual({ "governing-law": "Delaware" }); // carried over
    expect(second!.messages).toHaveLength(5);
    expect(draftCalls(backend).map((c) => c.request)).toEqual(["POST /api/drafts", "POST /api/drafts"]);
    expect(onDraftId).toHaveBeenLastCalledWith(2);
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/create/?draft=2");
  });

  it("keeps saving to the new draft after a switch", async () => {
    const backend = mockChatApi(csaTurn("CSA."), chatReply("SLA.", { documentType: "sla" }), chatReply("More SLA."));
    const user = setup();
    await say(user, "csa", "CSA.");
    await saved();
    await say(user, "sla", "SLA.");
    await waitFor(() => expect(backend.drafts.size).toBe(2));
    await say(user, "more", "More SLA.");
    await waitFor(() => expect(draftCalls(backend).map((c) => c.request)).toEqual(["POST /api/drafts", "POST /api/drafts", "PUT /api/drafts/2"]));
  });

  it("shows that it is saving, then that it is saved", async () => {
    const backend = mockChatApi(csaTurn("CSA."));
    const real = backend.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    backend.mockImplementation(async (url, init) => {
      if (String(url) === "/api/drafts") await gate;
      return real(url, init);
    });
    const user = setup();
    await say(user, "csa", "CSA.");

    expect(await screen.findByText("Saving…")).toBeInTheDocument();
    release();
    expect(await saved()).toBeInTheDocument();
    expect(screen.queryByText("Saving…")).not.toBeInTheDocument();
  });

  it("leaves the address alone when the first save finishes after the editor has been left", async () => {
    const backend = mockChatApi(csaTurn("CSA."));
    const real = backend.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    backend.mockImplementation(async (url, init) => {
      if (String(url) === "/api/drafts") await gate;
      return real(url, init);
    });
    const onDraftId = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(<DocumentCreator templates={templates} onDraftId={onDraftId} onClose={onClose} />);
    await say(user, "csa", "CSA.");
    await screen.findByText("Saving…");

    view.unmount(); // the user went to My documents
    expect(onClose).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect([...backend.drafts.keys()]).toEqual([1])); // the work is still saved...
    expect(onDraftId).not.toHaveBeenCalled(); // ...but the page they are on now is not touched
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("puts saves in order, so a slow first save cannot be overtaken by the next", async () => {
    const backend = mockChatApi(csaTurn("First."), csaTurn("Second."));
    const real = backend.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    backend.mockImplementation(async (url, init) => {
      if (String(url) === "/api/drafts" && init?.method === "POST") await gate;
      return real(url, init);
    });
    const user = setup();
    await say(user, "one", "First.");
    await say(user, "two", "Second."); // while the first save is still in flight
    expect(draftCalls(backend).map((c) => c.request)).toEqual(["POST /api/drafts"]);

    release();
    await waitFor(() => expect(draftCalls(backend).map((c) => c.request)).toEqual(["POST /api/drafts", "PUT /api/drafts/1"]));
    expect([...backend.drafts.keys()]).toEqual([1]); // one draft, not two
    await saved();
  });

  it("says when a draft could not be saved, keeps the document, and saves it on retry", async () => {
    const backend = mockChatApi(csaTurn("CSA.", { fieldValues: [{ key: "governing-law", value: "Delaware" }] }));
    backend.failNextDraftWrites(1);
    const user = setup();
    await say(user, "csa", "CSA.");

    const alert = await screen.findByText("Couldn't save this draft.");
    expect(alert.closest("[role=alert]")).toBeInTheDocument();
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    expect(section("Key Terms")).toHaveTextContent("Governing Law: Delaware");
    expect(backend.drafts.size).toBe(0);

    await user.click(screen.getByRole("button", { name: "Try again", description: "" }));
    await saved();
    expect(backend.drafts.size).toBe(1);
    expect(screen.queryByText("Couldn't save this draft.")).not.toBeInTheDocument();
  });

  it("reports a save that failed for lack of a connection", async () => {
    const backend = mockChatApi(csaTurn("CSA."));
    backend.failNextDraftWrites(1, 0);
    const user = setup();
    await say(user, "csa", "CSA.");
    expect(await screen.findByText("Couldn't save this draft.")).toBeInTheDocument();
  });

  it("carries on from a saved draft: restores the conversation and document, and saves to the same draft", async () => {
    const backend = mockChatApi(csaTurn("Next.", { fieldValues: [{ key: "chosen-courts", value: "Courts" }] }));
    backend.drafts.set(4, {
      id: 4,
      documentType: "csa",
      documentName: "Cloud Service Agreement",
      companies: ["Acme Inc"],
      createdAt: "2026-09-01T10:00:00.000000Z",
      updatedAt: "2026-09-01T10:00:00.000000Z",
      state: {},
      messages: [],
    });
    const session: EditorSession = {
      draftId: 4,
      state: {
        ...initialCreatorState,
        documentType: "csa",
        values: { "governing-law": "Delaware" },
        parties: { Provider: { company: "Acme Inc", name: "", title: "", address: "" } },
      },
      messages: [
        { role: "assistant", content: "Hello there." },
        { role: "user", content: "A CSA for Acme." },
        { role: "assistant", content: "Recorded the parties." },
      ],
    };
    const user = setup({ session });

    // The saved conversation and document are back, not the greeting.
    expect(screen.getByRole("log")).toHaveTextContent("Recorded the parties.");
    expect(screen.getByRole("log")).not.toHaveTextContent("What do you need?");
    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(section("Key Terms")).toHaveTextContent("Governing Law: Delaware");
    expect(section("Parties")).toHaveTextContent("Provider: Acme Inc");
    expect(await saved()).toBeInTheDocument();
    expect(draftCalls(backend)).toEqual([]); // opening it does not save it

    await say(user, "courts please", "Next.");
    await waitFor(() => expect(draftCalls(backend).map((c) => c.request)).toEqual(["PUT /api/drafts/4"]));
    const saved4 = backend.drafts.get(4)!;
    expect((saved4.state as { values: object }).values).toEqual({ "governing-law": "Delaware", "chosen-courts": "Courts" });
    expect(saved4.messages).toHaveLength(5);
    expect(backend.drafts.size).toBe(1);
  });
});

describe("download", () => {
  let print: ReturnType<typeof vi.fn>;
  let titleAtPrint: string[];

  beforeEach(() => {
    titleAtPrint = [];
    print = vi.fn(() => titleAtPrint.push(document.title));
    vi.stubGlobal("print", print);
    document.title = "Prelegal";
  });

  const click = (user: ReturnType<typeof userEvent.setup>) => user.click(download());

  it("opens the print dialog", async () => {
    mockChatApi(ndaReply("ok"));
    const user = setup();
    await say(user, "nda", "ok");
    await click(user);
    expect(print).toHaveBeenCalledOnce();
  });

  it("names an NDA PDF after the agreement and the parties while printing", async () => {
    mockChatApi(
      ndaReply("ok", { party1: { ...noParty, company: "Acme Corp" }, party2: { ...noParty, company: "Globex" } }),
    );
    const user = setup();
    await say(user, "Acme and Globex", "ok");
    await click(user);
    expect(titleAtPrint).toEqual(["Mutual NDA - Acme Corp - Globex"]);
  });

  it("falls back to 'Mutual NDA' when no companies are known and ignores blank ones", async () => {
    mockChatApi(ndaReply("ok"), ndaReply("ok2", { party2: { ...noParty, company: "Globex" } }));
    const user = setup();
    await say(user, "nda", "ok");
    await click(user);
    expect(titleAtPrint).toEqual(["Mutual NDA"]);
    window.dispatchEvent(new Event("afterprint"));

    await say(user, "Globex", "ok2");
    await click(user);
    expect(titleAtPrint.at(-1)).toBe("Mutual NDA - Globex");
  });

  it("names another document's PDF after the document and its parties", async () => {
    mockChatApi(
      csaTurn("ok", {
        parties: [
          { role: "Provider", ...noParty, company: "Acme" },
          { role: "Customer", ...noParty, company: "Globex" },
        ],
      }),
    );
    const user = setup();
    await say(user, "csa", "ok");
    await screen.findByRole("article", { name: "Cloud Service Agreement" });
    await click(user);
    expect(titleAtPrint).toEqual(["Cloud Service Agreement - Globex - Acme"]);
  });

  it("restores the page title after printing", async () => {
    mockChatApi(ndaReply("ok"));
    const user = setup();
    await say(user, "nda", "ok");
    await click(user);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await waitFor(() => expect(document.title).toBe("Prelegal"));
  });

  // Review-reported: the original title is captured per click, so if `afterprint` is missed once
  // the temporary title becomes the "original" and sticks. Remove `.fails` once fixed.
  it.fails("restores the original title even if afterprint never fired for an earlier click", async () => {
    mockChatApi(ndaReply("ok"));
    const user = setup();
    await say(user, "nda", "ok");
    await click(user);
    await click(user);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Prelegal");
  });
});
