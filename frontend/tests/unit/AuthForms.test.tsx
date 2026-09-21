import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm, SignUpForm } from "@/components/AuthForms";
import { AuthProvider } from "@/lib/auth";
import { TAKEN_EMAIL, TEST_PASSWORD, mockChatApi, type FakeBackend } from "./chatFixtures";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));

const slash = (path: string) => expect.stringMatching(new RegExp(`^${path}/?$`));

let backend: FakeBackend;

beforeEach(() => {
  nav.router.push.mockClear();
  nav.router.replace.mockClear();
  backend = mockChatApi();
  backend.signedInAs = null;
});
afterEach(() => vi.unstubAllGlobals());

const authCalls = () =>
  backend.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/auth/") && url !== "/api/auth/session");

const setup = (form: "in" | "up") => {
  const user = userEvent.setup();
  render(<AuthProvider>{form === "in" ? <SignInForm /> : <SignUpForm />}</AuthProvider>);
  return user;
};
const password = () => screen.getByLabelText("Password", { exact: true });

describe("SignInForm", () => {
  it("has a heading, both fields and a way to create an account", () => {
    setup("in");
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(password()).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", slash("/signup"));
  });

  it("asks for what is missing, without sending anything", async () => {
    const user = setup("in");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(authCalls()).toEqual([]);
  });

  it("does not show errors before the first attempt", () => {
    setup("in");
    expect(screen.queryByText("Enter your email address.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
  });

  it("rejects an email address that is not one", async () => {
    const user = setup("in");
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.type(password(), "whatever");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(authCalls()).toEqual([]);
  });

  it("signs in and goes to My documents", async () => {
    const user = setup("in");
    await user.type(screen.getByLabelText("Email"), "  ada@example.com ");
    await user.type(password(), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    // One navigation: the redirect that follows the state change (no second, imperative one).
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/documents/"));
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.push).not.toHaveBeenCalled();
    const login = backend.mock.calls.find(([url]) => url === "/api/auth/login")!;
    expect(JSON.parse((login[1] as RequestInit).body as string)).toEqual({ email: "ada@example.com", password: TEST_PASSWORD });
  });

  it("says what went wrong and lets the user try again", async () => {
    const user = setup("in");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(password(), "wrong password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(password()).toHaveValue("wrong password"); // what was typed is kept
  });

  it("shows that it is working while signing in", async () => {
    const real = backend.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    backend.mockImplementation(async (url, init) => {
      if (url === "/api/auth/login") await gate;
      return real(url, init);
    });
    const user = setup("in");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(password(), TEST_PASSWORD);
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveAttribute("aria-busy", "true");
    release();
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/documents/"));
  });

  it("can show and hide the password", async () => {
    const user = setup("in");
    await user.type(password(), "secret-words");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password()).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password()).toHaveAttribute("type", "password");
  });

  it("announces the password toggle once: by its label, not also as a pressed state", async () => {
    setup("in");
    expect(screen.getByRole("button", { name: "Show password" })).not.toHaveAttribute("aria-pressed");
  });

  it("sends someone who is already signed in straight to their documents", async () => {
    backend.signedInAs = { id: 1, name: "Ada Lovelace", email: "ada@example.com" };
    setup("in");
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/documents/"));
  });
});

describe("SignUpForm", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, details: { name?: string; email?: string; password?: string }) => {
    if (details.name) await user.type(screen.getByLabelText("Full name"), details.name);
    if (details.email) await user.type(screen.getByLabelText("Work email"), details.email);
    if (details.password) await user.type(password(), details.password);
  };

  it("asks for a name, an email and a password, and says how long the password must be", () => {
    setup("up");
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(password()).toHaveAccessibleDescription("At least 8 characters.");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/");
  });

  it("leaves the draft disclaimer to the page around it, so it is shown once", () => {
    setup("up");
    expect(screen.queryByText(/legal review|lawyer|legal advice/i)).not.toBeInTheDocument();
  });

  it("limits the length of what can be typed to what the server accepts", () => {
    setup("up");
    expect(screen.getByLabelText("Full name")).toHaveAttribute("maxLength", "100");
    expect(screen.getByLabelText("Work email")).toHaveAttribute("maxLength", "254");
    expect(password()).toHaveAttribute("maxLength", "128");
  });

  it("explains each problem, next to the field, and sends nothing", async () => {
    const user = setup("up");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address, like name@company.com.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toHaveAccessibleDescription("Enter your name.");
    expect(authCalls()).toEqual([]);
  });

  it("refuses a short password", async () => {
    const user = setup("up");
    await fill(user, { name: "Ada", email: "ada@example.com", password: "short" });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(authCalls()).toEqual([]);
  });

  it("clears an error once the field is put right", async () => {
    const user = setup("up");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(screen.getByLabelText("Full name"), "Ada");
    expect(screen.queryByText("Enter your name.")).not.toBeInTheDocument();
  });

  it("creates the account and goes to My documents", async () => {
    const user = setup("up");
    await fill(user, { name: "  Grace Hopper ", email: "grace@example.com", password: "a long enough password" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/documents/"));
    expect(nav.router.replace).toHaveBeenCalledTimes(1);
    expect(nav.router.push).not.toHaveBeenCalled();
    const signup = backend.mock.calls.find(([url]) => url === "/api/auth/signup")!;
    expect(JSON.parse((signup[1] as RequestInit).body as string)).toEqual({
      name: "Grace Hopper",
      email: "grace@example.com",
      password: "a long enough password",
    });
  });

  it("says when the email is already registered", async () => {
    const user = setup("up");
    await fill(user, { name: "Ada", email: TAKEN_EMAIL, password: "a long enough password" });
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists");
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Work email")).toHaveValue(TAKEN_EMAIL);
  });

  it("says when the server cannot be reached", async () => {
    const real = backend.getMockImplementation()!;
    backend.mockImplementation(async (url, init) => {
      if (url === "/api/auth/signup") throw new TypeError("Failed to fetch");
      return real(url, init);
    });
    const user = setup("up");
    await fill(user, { name: "Ada", email: "ada@example.com", password: "a long enough password" });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  });
});
