import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NdaCreator } from "@/components/NdaCreator";
import { loadMutualNdaTemplates, type MutualNdaTemplates } from "@/lib/templates";
import { chatReply, mockChatApi, noParty, requestBody } from "./chatFixtures";

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
  render(<NdaCreator templates={templates} />);
  return user;
};

const doc = () => screen.getByRole("article");
const section = (heading: string) =>
  within(doc()).getByRole("heading", { name: heading }).closest("section") as HTMLElement;

async function say(user: ReturnType<typeof userEvent.setup>, message: string, reply: string) {
  await user.type(screen.getByLabelText("Message"), message);
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(reply);
}

describe("initial render", () => {
  it("shows the chat, the agreement and the download button, and no form", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Mutual NDA creator" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Chat with the assistant" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    expect(within(doc()).getByRole("heading", { name: "Standard Terms" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Governing law (state)")).not.toBeInTheDocument();
  });

  it("defaults the effective date to today's local date", () => {
    setup();
    expect(section("Effective Date")).toHaveTextContent("September 19, 2026");
  });
});

describe("chat -> document", () => {
  it("fills the agreement in from the assistant's updates", async () => {
    mockChatApi(
      chatReply("Recorded. Who signs for Globex?", {
        purpose: "Exploring a joint venture.",
        governingLaw: "Delaware",
        jurisdiction: "New Castle, DE",
        termType: "continues",
        confidentialityType: "perpetuity",
        party1: { ...noParty, company: "Acme Corp", name: "Jane Doe" },
        party2: { ...noParty, company: "Globex" },
      }),
    );
    const user = setup();
    await say(user, "Acme and Globex, Delaware", "Recorded. Who signs for Globex?");

    expect(section("Purpose")).toHaveTextContent("Exploring a joint venture.");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Governing Law: Delaware");
    expect(doc()).toHaveTextContent("courts located in New Castle, DE. Each party");
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Continues/);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*In\ perpetuity\./);
    expect(doc()).toHaveTextContent("Jane Doe");
    expect(doc()).toHaveTextContent("Globex");
  });

  it("accumulates updates across turns and tells the assistant what is already filled in", async () => {
    const fetchMock = mockChatApi(
      chatReply("Which state?", { party1: { ...noParty, company: "Acme" } }),
      chatReply("Thanks", { governingLaw: "Ohio" }),
    );
    const user = setup();
    await say(user, "Acme", "Which state?");
    await say(user, "Ohio", "Thanks");

    expect(doc()).toHaveTextContent("Acme");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Governing Law: Ohio");
    const second = requestBody(fetchMock, 1).fields;
    expect(second.party1.company).toBe("Acme");
    expect(second.governingLaw).toBeNull();
  });

  it("leaves the document alone when the request fails", async () => {
    mockChatApi({ status: 502, body: { detail: "The AI assistant could not respond." } });
    const user = setup();
    await user.type(screen.getByLabelText("Message"), "Acme");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByRole("alert");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("[Fill in state]");
  });
});

describe("download", () => {
  let print: ReturnType<typeof vi.fn>;
  let titleAtPrint: string[];

  beforeEach(() => {
    titleAtPrint = [];
    print = vi.fn(() => titleAtPrint.push(document.title));
    vi.stubGlobal("print", print);
    document.title = "Prelegal - Mutual NDA creator";
  });

  const download = (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: "Download PDF" }));

  it("opens the print dialog", async () => {
    const user = setup();
    await download(user);
    expect(print).toHaveBeenCalledOnce();
  });

  it("names the PDF after the agreement and the parties while printing", async () => {
    mockChatApi(
      chatReply("ok", { party1: { ...noParty, company: "Acme Corp" }, party2: { ...noParty, company: "Globex" } }),
    );
    const user = setup();
    await say(user, "Acme and Globex", "ok");
    await download(user);
    expect(titleAtPrint).toEqual(["Mutual NDA - Acme Corp - Globex"]);
  });

  it("falls back to 'Mutual NDA' when no companies are known and ignores blank ones", async () => {
    mockChatApi(chatReply("ok", { party2: { ...noParty, company: "Globex" } }));
    const user = setup();
    await download(user);
    expect(titleAtPrint).toEqual(["Mutual NDA"]);
    window.dispatchEvent(new Event("afterprint"));

    await say(user, "Globex", "ok");
    await download(user);
    expect(titleAtPrint.at(-1)).toBe("Mutual NDA - Globex");
  });

  it("restores the page title after printing", async () => {
    const user = setup();
    await download(user);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Prelegal - Mutual NDA creator");
  });

  // Review-reported: the original title is captured per click, so if `afterprint` is missed once
  // the temporary title becomes the "original" and sticks. Remove `.fails` once fixed.
  it.fails("restores the original title even if afterprint never fired for an earlier click", async () => {
    const user = setup();
    await download(user);
    await download(user);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Prelegal - Mutual NDA creator");
  });
});
