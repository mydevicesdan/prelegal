import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { AuthProvider, initials, useAuth } from "@/lib/auth";
import { TEST_PASSWORD, TEST_USER, TAKEN_EMAIL, mockChatApi } from "./chatFixtures";

afterEach(() => vi.unstubAllGlobals());

/** Shows the auth state as text and exposes the actions, so tests can drive the provider. */
const captured: { auth: ReturnType<typeof useAuth> | null } = { auth: null };
const actions = () => captured.auth!;
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    captured.auth = auth;
  });
  const { state } = auth;
  return <p>{state.status === "signedIn" ? `signed in as ${state.user.name}` : state.status}</p>;
}
const setup = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

describe("AuthProvider", () => {
  it("starts loading, then reports nobody signed in", async () => {
    mockChatApi().signedInAs = null;
    setup();
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("signedOut")).toBeInTheDocument();
  });

  it("reports the signed-in user the server knows about", async () => {
    mockChatApi();
    setup();
    expect(await screen.findByText("signed in as Ada Lovelace")).toBeInTheDocument();
  });

  it("treats an unreachable server as signed out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    setup();
    expect(await screen.findByText("signedOut")).toBeInTheDocument();
  });

  it("signs out when any request finds the session gone", async () => {
    mockChatApi();
    setup();
    await screen.findByText("signed in as Ada Lovelace");
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(await screen.findByText("signedOut")).toBeInTheDocument();
  });

  it("signs in", async () => {
    mockChatApi().signedInAs = null;
    setup();
    await screen.findByText("signedOut");
    await act(() => actions().signIn(TEST_USER.email, TEST_PASSWORD));
    expect(screen.getByText("signed in as Ada Lovelace")).toBeInTheDocument();
  });

  it("stays signed out, and says why, when the password is wrong", async () => {
    mockChatApi().signedInAs = null;
    setup();
    await screen.findByText("signedOut");
    await expect(actions().signIn(TEST_USER.email, "nope")).rejects.toThrow("Incorrect email or password.");
    expect(screen.getByText("signedOut")).toBeInTheDocument();
  });

  it("signs up and is signed in as the new user", async () => {
    mockChatApi().signedInAs = null;
    setup();
    await screen.findByText("signedOut");
    await act(() => actions().signUp("Grace Hopper", "grace@example.com", "a long enough password"));
    expect(screen.getByText("signed in as Grace Hopper")).toBeInTheDocument();
  });

  it("refuses an email that is already registered", async () => {
    mockChatApi().signedInAs = null;
    setup();
    await screen.findByText("signedOut");
    await expect(actions().signUp("Ada", TAKEN_EMAIL, "a long enough password")).rejects.toThrow("already exists");
    expect(screen.getByText("signedOut")).toBeInTheDocument();
  });

  it("signs out", async () => {
    const backend = mockChatApi();
    setup();
    await screen.findByText("signed in as Ada Lovelace");
    await act(() => actions().signOut());
    expect(screen.getByText("signedOut")).toBeInTheDocument();
    expect(backend.signedInAs).toBeNull();
  });

  it("stays signed in, and says so, when the server could not end the session", async () => {
    const backend = mockChatApi();
    setup();
    await screen.findByText("signed in as Ada Lovelace");
    const real = backend.getMockImplementation()!;
    backend.mockImplementation(async (url, init) => {
      if (String(url) === "/api/auth/logout") throw new TypeError("Failed to fetch");
      return real(url, init);
    });
    // Pretending to be signed out would leave the cookie alive: the next reload would sign the person back in.
    await act(async () => {
      await expect(actions().signOut()).rejects.toThrow();
    });
    expect(screen.getByText("signed in as Ada Lovelace")).toBeInTheDocument();
  });

  it("must be used inside the provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside <AuthProvider>");
    error.mockRestore();
  });
});

describe("initials", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["ada", "A"],
    ["  grace   brewster  murray hopper ", "GH"],
    ["Émile Zola", "ÉZ"],
    ["", ""],
  ])("%j -> %j", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
