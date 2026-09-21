import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentCreator } from "@/components/DocumentCreator";
import { loadMutualNdaTemplates, type MutualNdaTemplates } from "@/lib/templates";
import { chatReply, documentCalls, mockChatApi, ndaReply, noParty, requestBody } from "./chatFixtures";

let templates: MutualNdaTemplates;

beforeAll(async () => {
  templates = await loadMutualNdaTemplates();
});

beforeEach(() => {
  // Freeze only Date so userEvent's timers keep working.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 19, 12, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const setup = () => {
  const user = userEvent.setup();
  render(<DocumentCreator templates={templates} />);
  return user;
};

const doc = () => screen.getByRole("article");
const section = (heading: string) =>
  within(doc()).getByRole("heading", { name: heading }).closest("section") as HTMLElement;
const download = () => screen.getByRole("button", { name: "Download PDF" });

async function say(user: ReturnType<typeof userEvent.setup>, message: string, reply: string) {
  await user.type(screen.getByLabelText("Message"), message);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(reply);
}

const csaTurn = (reply: string, extra: Partial<Parameters<typeof chatReply>[1]> = {}) =>
  chatReply(reply, { documentType: "csa", ...extra });

describe("before a document is chosen", () => {
  it("shows the chat and an empty preview, with nothing to download", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Legal document creator" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Chat with the assistant" })).toBeInTheDocument();
    expect(screen.getByText(/Your document will appear here/)).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(download()).toBeDisabled();
    expect(screen.queryByText(/Drafting:/)).not.toBeInTheDocument();
  });

  it("stays empty when the assistant declines an unsupported request", async () => {
    const reply = "Sorry, I can't draft an employment agreement. The closest is the NDA.";
    const fetchMock = mockChatApi(chatReply(reply));
    const user = setup();
    await say(user, "I need an employment agreement", reply);

    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(download()).toBeDisabled();
    expect(documentCalls(fetchMock)).toEqual([]);
  });
});

describe("Mutual NDA", () => {
  it("shows the NDA as soon as the assistant chooses it, with today's effective date", async () => {
    mockChatApi(ndaReply("An NDA. Who are the parties?"));
    const user = setup();
    await say(user, "an NDA please", "An NDA. Who are the parties?");

    expect(within(doc()).getByRole("heading", { name: "Standard Terms" })).toBeInTheDocument();
    expect(section("Effective Date")).toHaveTextContent("September 19, 2026");
    expect(screen.getByText("Drafting: Mutual Non-Disclosure Agreement")).toBeInTheDocument();
    expect(download()).toBeEnabled();
  });

  it("fills the agreement in from the assistant's updates and across turns", async () => {
    const fetchMock = mockChatApi(
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
    const second = requestBody(fetchMock, 1);
    expect(second.documentType).toBe("mutual-nda");
    expect(second.fields.party1.company).toBe("Acme Corp");
  });
});

describe("other documents", () => {
  it("loads the chosen document once and shows its generated front page", async () => {
    const fetchMock = mockChatApi(csaTurn("A CSA. Who are the parties?"), csaTurn("Thanks."));
    const user = setup();
    await say(user, "a SaaS agreement", "A CSA. Who are the parties?");

    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(section("Order Form")).toHaveTextContent("Subscription Period: [Subscription Period]");
    expect(download()).toBeEnabled();

    await say(user, "more", "Thanks.");
    expect(documentCalls(fetchMock)).toEqual(["/api/documents/csa"]);
  });

  it("fills in values and party details as the assistant learns them, and shows the progress", async () => {
    const fetchMock = mockChatApi(
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
    expect(screen.getByText("Drafting: Cloud Service Agreement · 2 of 3 details filled in")).toBeInTheDocument();

    await say(user, "courts?", "Thanks.");
    expect(screen.getByText("Drafting: Cloud Service Agreement · 3 of 3 details filled in")).toBeInTheDocument();
    // The assistant is told everything that has been filled in so far.
    const body = requestBody(fetchMock, 1);
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

  it("keeps what carries over when the assistant switches to another document, and loads it", async () => {
    const fetchMock = mockChatApi(
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
    expect(documentCalls(fetchMock)).toEqual(["/api/documents/csa", "/api/documents/sla"]);
  });

  it("goes back to a document without loading it again, with its values intact", async () => {
    const fetchMock = mockChatApi(
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
    expect(documentCalls(fetchMock)).toEqual(["/api/documents/csa", "/api/documents/sla"]);
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
    const fetchMock = mockChatApi(csaTurn("A CSA."));
    const real = fetchMock.getMockImplementation()!;
    let failures = 1;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/documents/") && failures-- > 0) throw new TypeError("Failed to fetch");
      return real(url);
    });
    const user = setup();
    await say(user, "a csa", "A CSA.");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(download()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Try loading it again" }));

    expect(await screen.findByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(download()).toBeEnabled();
  });

  it("shows a loading message while the document loads", async () => {
    const fetchMock = mockChatApi(csaTurn("A CSA."));
    const real = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/documents/")) await gate;
      return real(url);
    });
    const user = setup();
    await say(user, "a csa", "A CSA.");

    expect(screen.getByText("Loading the document…")).toBeInTheDocument();
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

    await screen.findByRole("alert");
    expect(screen.getByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
  });
});

describe("download", () => {
  let print: ReturnType<typeof vi.fn>;
  let titleAtPrint: string[];

  beforeEach(() => {
    titleAtPrint = [];
    print = vi.fn(() => titleAtPrint.push(document.title));
    vi.stubGlobal("print", print);
    document.title = "Prelegal - Legal document creator";
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
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(document.title).toBe("Prelegal - Legal document creator"));
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
    expect(document.title).toBe("Prelegal - Legal document creator");
  });
});
