import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DraftDisclaimer, PrintDisclaimer } from "@/components/Disclaimer";
import { Alert, Button, ButtonLink, Logo, TextField } from "@/components/ui";

describe("Button", () => {
  it("runs its action when clicked", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is busy and cannot be clicked again while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("can be disabled", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-busy");
  });

  it("does not submit a form unless it is a submit button", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="button">Plain</Button>
        <Button type="submit">Send</Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Plain" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("ButtonLink", () => {
  it("is a link", () => {
    render(<ButtonLink href="/somewhere">Go</ButtonLink>);
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("href", "/somewhere");
  });
});

describe("TextField", () => {
  it("labels its input", () => {
    render(<TextField label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("describes an error to assistive technology and marks the field invalid", () => {
    render(<TextField label="Email" error="Enter your email." hint="We never share it." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter your email.");
  });

  it("describes a hint when there is no error", () => {
    render(<TextField label="Password" hint="At least 8 characters." />);
    const input = screen.getByLabelText("Password");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAccessibleDescription("At least 8 characters.");
  });

  it("gives each field its own id, so two fields never share a label", () => {
    render(
      <>
        <TextField label="First" />
        <TextField label="Second" />
      </>,
    );
    expect(screen.getByLabelText("First").id).not.toBe(screen.getByLabelText("Second").id);
  });

  it("passes input attributes through", () => {
    render(<TextField label="Email" type="email" autoComplete="email" maxLength={20} />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("maxlength", "20");
  });

  it("shows something on the trailing edge", () => {
    render(<TextField label="Password" trailing={<button type="button">Show</button>} />);
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });
});

describe("Alert", () => {
  it("interrupts screen readers for an error", () => {
    render(<Alert>It failed.</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("It failed.");
  });

  it("is a polite status for information", () => {
    render(<Alert tone="info">FYI.</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("FYI.");
  });
});

describe("Logo", () => {
  it("shows the name, and hides the decorative mark", () => {
    const { container } = render(<Logo />);
    expect(screen.getByText("Prelegal")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("disclaimers", () => {
  it("tells the reader the document is a draft that needs a lawyer", () => {
    render(<DraftDisclaimer />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Draft for review");
    expect(note).toHaveTextContent("not legal advice");
    expect(note).toHaveTextContent("qualified lawyer");
  });

  it("is hidden when printing, because the printed page carries its own", () => {
    render(<DraftDisclaimer />);
    expect(screen.getByRole("note")).toHaveClass("print:hidden");
  });

  it("has a printed version for the foot of every page", () => {
    const { container } = render(<PrintDisclaimer />);
    expect(container.querySelector(".print-disclaimer")).toHaveTextContent("Draft, subject to legal review. Not legal advice.");
  });
});
