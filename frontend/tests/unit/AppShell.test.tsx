import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { AuthProvider } from "@/lib/auth";
import { mockChatApi, type FakeBackend } from "./chatFixtures";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, pathname: "/documents/" }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => nav.pathname }));

const slash = (path: string) => expect.stringMatching(new RegExp(`^${path}/?$`));

let backend: FakeBackend;

beforeEach(() => {
  nav.router.push.mockClear();
  nav.router.replace.mockClear();
  nav.pathname = "/documents/";
  backend = mockChatApi();
});
afterEach(() => vi.unstubAllGlobals());

const setup = () => {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <AppShell>
        <p>the page</p>
      </AppShell>
    </AuthProvider>,
  );
  return user;
};

describe("AppShell", () => {
  it("shows a loading state, not the page, until it knows who is signed in", async () => {
    setup();
    expect(screen.queryByText("the page")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("the page")).toBeInTheDocument();
  });

  it("sends someone who is not signed in to the sign in page, and never shows the page", async () => {
    backend.signedInAs = null;
    setup();
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("the page")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("shows the page with the header, the user and the footer", async () => {
    setup();
    await screen.findByText("the page");
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Prelegal, my documents" })).toHaveAttribute("href", slash("/documents"));
    expect(within(header).getByText("AL")).toBeInTheDocument();
    expect(within(header).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("the page");
  });

  it("carries the draft disclaimer in the footer on every page", async () => {
    setup();
    await screen.findByText("the page");
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent("drafts and are subject to legal review");
    expect(footer).toHaveTextContent("does not give legal advice");
    expect(footer).toHaveTextContent("Common Paper, CC BY 4.0");
  });

  it("does not repeat the disclaimer in the editor, which shows its own above the agreement", async () => {
    nav.pathname = "/create/";
    setup();
    await screen.findByText("the page");
    const footer = screen.getByRole("contentinfo");
    expect(footer).not.toHaveTextContent("subject to legal review");
    expect(footer).toHaveTextContent("Common Paper, CC BY 4.0");
  });

  it("offers a way past the navigation for keyboard users", async () => {
    setup();
    await screen.findByText("the page");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("marks My documents as the current page when on it", async () => {
    setup();
    await screen.findByText("the page");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "My documents" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark it on other pages", async () => {
    nav.pathname = "/create/";
    setup();
    await screen.findByText("the page");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "My documents" })).not.toHaveAttribute("aria-current");
  });

  it("links New document to a fresh editor", async () => {
    setup();
    await screen.findByText("the page");
    expect(screen.getByRole("link", { name: "New document" })).toHaveAttribute("href", slash("/create"));
  });

  it("starts a fresh editor even when the user is already in one", async () => {
    nav.pathname = "/create/";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
    const user = setup();
    await screen.findByText("the page");
    await user.click(screen.getByRole("link", { name: "New document" }));
    expect(nav.router.push).toHaveBeenCalledWith(`/create/?new=${Date.parse("2026-09-20T12:00:00Z")}`);
    vi.useRealTimers();
  });

  it("stays signed in, and says so, when the server could not end the session", async () => {
    const real = backend.getMockImplementation()!;
    backend.mockImplementation(async (url, init) => {
      if (url === "/api/auth/logout") throw new TypeError("Failed to fetch");
      return real(url, init);
    });
    const user = setup();
    await screen.findByText("the page");
    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You are still signed in.");
    expect(screen.getByText("the page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled(); // and can try again
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("logs out and returns to the sign in page", async () => {
    const user = setup();
    await screen.findByText("the page");
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/"));
    expect(backend.signedInAs).toBeNull();
  });
});
