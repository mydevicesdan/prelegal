import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/LoginForm";
import { RequireLogin } from "@/components/RequireLogin";
import { readSession, startSession } from "@/lib/session";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  sessionStorage.clear();
  router.push.mockClear();
  router.replace.mockClear();
});

describe("LoginForm", () => {
  it("signs in with any details and opens the document creator", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), " me@example.com ");
    await user.type(screen.getByLabelText("Password"), "anything");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(readSession()).toBe("me@example.com");
    expect(router.push).toHaveBeenCalledWith("/documents/");
  });

  it("accepts an empty form", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(router.push).toHaveBeenCalledWith("/documents/");
  });
});

describe("RequireLogin", () => {
  it("redirects to login and renders nothing without a session", () => {
    render(<RequireLogin><p>secret</p></RequireLogin>);
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("shows children and the signed-in email with a session", () => {
    startSession("me@example.com");
    render(<RequireLogin><p>secret</p></RequireLogin>);
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.getByText("me@example.com")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("treats a session with an empty email as signed in", () => {
    startSession("");
    render(<RequireLogin><p>secret</p></RequireLogin>);
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("log out clears the session and returns to login", async () => {
    startSession("me@example.com");
    const user = userEvent.setup();
    render(<RequireLogin><p>secret</p></RequireLogin>);
    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(readSession()).toBeNull();
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});
