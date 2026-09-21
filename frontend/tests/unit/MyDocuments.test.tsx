import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyDocuments } from "@/components/MyDocuments";
import { draftCalls, mockChatApi, type FakeBackend, type FakeDraft } from "./chatFixtures";

let backend: FakeBackend;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
  backend = mockChatApi();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const slash = (path: string) => expect.stringMatching(new RegExp(`^${path.replace("?", "\\?")}/?$`));

function addDraft(id: number, overrides: Partial<FakeDraft> = {}) {
  backend.drafts.set(id, {
    id,
    documentType: "csa",
    documentName: "Cloud Service Agreement",
    companies: ["Acme Inc", "Globex LLC"],
    createdAt: "2026-09-20T11:00:00.000Z",
    updatedAt: "2026-09-20T11:55:00.000Z",
    state: {},
    messages: [],
    ...overrides,
  });
}

const setup = () => {
  const user = userEvent.setup();
  render(<MyDocuments />);
  return user;
};
const rows = () => screen.getAllByRole("listitem");
const title = (name: string) => screen.findByRole("link", { name });

describe("MyDocuments", () => {
  it("has a heading and a way to start a document", async () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "My documents" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New document" })).toHaveAttribute("href", slash("/create"));
    await screen.findByText("No documents yet");
  });

  it("shows a loading state while the drafts arrive", async () => {
    const real = backend.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    backend.mockImplementation(async (url, init) => {
      if (url === "/api/drafts") await gate;
      return real(url, init);
    });
    addDraft(1);
    setup();
    const loading = screen.getByRole("status");
    expect(loading).toHaveTextContent("Loading your documents");
    expect(loading).toHaveAttribute("aria-busy", "true");
    release();
    await title("Cloud Service Agreement");
    expect(screen.queryByText("Loading your documents")).not.toBeInTheDocument();
  });

  it("invites the user to start when there is nothing yet", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "No documents yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a document" })).toHaveAttribute("href", slash("/create"));
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("lists each draft with its name, parties, status and age", async () => {
    addDraft(1);
    addDraft(2, {
      documentType: "mutual-nda",
      documentName: "Mutual Non-Disclosure Agreement",
      companies: ["Acme Inc"],
      updatedAt: "2026-09-18T09:00:00.000Z",
    });
    setup();
    await title("Cloud Service Agreement");

    const [first, second] = rows();
    expect(first).toHaveTextContent("Cloud Service Agreement");
    expect(first).toHaveTextContent("Acme Inc and Globex LLC");
    expect(first).toHaveTextContent("Draft");
    expect(first).toHaveTextContent("Updated 5 minutes ago");
    expect(second).toHaveTextContent("Mutual Non-Disclosure Agreement");
    expect(second).toHaveTextContent("Acme Inc");
    expect(second).not.toHaveTextContent("and");
    expect(second).toHaveTextContent("Updated 2 days ago");
  });

  it("puts the most recently changed draft first", async () => {
    addDraft(1, { updatedAt: "2026-09-19T10:00:00.000Z", documentName: "Older" });
    addDraft(2, { updatedAt: "2026-09-20T11:00:00.000Z", documentName: "Newer" });
    setup();
    await title("Newer");
    expect(rows().map((row) => within(row).getAllByRole("link")[0]!.textContent)).toEqual(["Newer", "Older"]);
  });

  it("says so when a draft has no parties yet", async () => {
    addDraft(1, { companies: [] });
    setup();
    expect(await screen.findByText("No parties named yet")).toBeInTheDocument();
  });

  it("shows the exact time when hovering over the age", async () => {
    addDraft(1);
    setup();
    await title("Cloud Service Agreement");
    const time = screen.getByText(/Updated 5 minutes ago/);
    expect(time).toHaveAttribute("datetime", "2026-09-20T11:55:00.000Z");
    expect(time.getAttribute("title")).toMatch(/September 20, 2026/);
  });

  it("opens a draft from its name or its Open button", async () => {
    addDraft(7);
    setup();
    await title("Cloud Service Agreement");
    const [name, open] = within(rows()[0]!).getAllByRole("link");
    expect(name).toHaveAttribute("href", slash("/create?draft=7"));
    expect(open).toHaveAttribute("href", slash("/create?draft=7"));
    expect(open).toHaveAccessibleName("Open Cloud Service Agreement, Acme Inc and Globex LLC");
  });

  describe("deleting", () => {
    it("asks first, and keeps the draft if the user changes their mind", async () => {
      addDraft(1);
      const user = setup();
      await title("Cloud Service Agreement");
      await user.click(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ }));

      expect(screen.getByText("Delete this document?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Keep" }));
      expect(screen.queryByText("Delete this document?")).not.toBeInTheDocument();
      expect(rows()).toHaveLength(1);
      expect(draftCalls(backend).map((c) => c.request)).toEqual(["GET /api/drafts"]);
    });

    it("keeps the keyboard user's place: focus follows the buttons that come and go", async () => {
      addDraft(1);
      const user = setup();
      await title("Cloud Service Agreement");
      await user.click(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ }));
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

      await user.click(screen.getByRole("button", { name: "Keep" }));
      expect(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ })).toHaveFocus();
    });

    it("moves focus to the page heading when the row it was in is deleted", async () => {
      addDraft(1);
      addDraft(2, { documentName: "Service Level Agreement", updatedAt: "2026-09-20T10:00:00.000Z" });
      const user = setup();
      await title("Cloud Service Agreement");
      await user.click(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(screen.getByRole("heading", { name: "My documents" })).toHaveFocus();
    });

    it("deletes the draft once confirmed", async () => {
      addDraft(1);
      addDraft(2, { documentName: "Service Level Agreement", updatedAt: "2026-09-20T10:00:00.000Z" });
      const user = setup();
      await title("Cloud Service Agreement");
      await user.click(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(rows()).toHaveLength(1));
      expect(screen.queryByRole("link", { name: "Cloud Service Agreement" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Service Level Agreement" })).toBeInTheDocument();
      expect([...backend.drafts.keys()]).toEqual([2]);
    });

    it("shows the empty state after the last draft is deleted", async () => {
      addDraft(1);
      const user = setup();
      await title("Cloud Service Agreement");
      await user.click(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(await screen.findByRole("heading", { name: "No documents yet" })).toBeInTheDocument();
    });

    it("says when a draft could not be deleted, and keeps it", async () => {
      addDraft(1);
      const user = setup();
      await title("Cloud Service Agreement");
      backend.failNextDraftWrites(1);
      await user.click(screen.getByRole("button", { name: /Delete Cloud Service Agreement/ }));
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem.");
      expect(rows()).toHaveLength(1);
      expect(backend.drafts.size).toBe(1);
    });
  });

  it("says when the drafts could not be loaded, and loads them on retry", async () => {
    addDraft(1);
    backend.failNextDraftReads(1);
    const user = setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem.");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await title("Cloud Service Agreement")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a lost connection", async () => {
    backend.failNextDraftReads(1, 0);
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
