import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NdaCreator } from "@/components/NdaCreator";
import { loadMutualNdaTemplates, type MutualNdaTemplates } from "@/lib/templates";

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
});

const setup = () => {
  const user = userEvent.setup();
  render(<NdaCreator templates={templates} />);
  return user;
};

/** Sets a field's value directly (user.type would interpret "[" and "{" as key descriptors). */
const setValue = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const doc = () => screen.getByRole("article");
const group = (name: string) => screen.getByRole("group", { name });
const section = (heading: string) =>
  within(doc()).getByRole("heading", { name: heading }).closest("section") as HTMLElement;

describe("initial render", () => {
  it("shows the form, the agreement and the download button", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Mutual NDA creator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
    expect(within(doc()).getByRole("heading", { name: "Mutual Non-Disclosure Agreement" })).toBeInTheDocument();
    expect(within(doc()).getByRole("heading", { name: "Standard Terms" })).toBeInTheDocument();
  });

  it("defaults the effective date to today's local date, in the form and the document", () => {
    setup();
    expect(screen.getByLabelText("Effective date")).toHaveValue("2026-09-19");
    expect(section("Effective Date")).toHaveTextContent("September 19, 2026");
  });

  it("pre-fills the template's default purpose, 1 year term and 1 year confidentiality", () => {
    setup();
    expect(screen.getByLabelText("Purpose")).toHaveValue(
      "Evaluating whether to enter into a business relationship with the other party.",
    );
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Expires\ 1\ year\(s\)\ from\ Effective\ Date\./);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*1 year\(s\) from Effective Date, but in the case of trade secrets/);
  });

  it("shows bracketed placeholders for required-but-empty fields", () => {
    setup();
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("[Fill in state]");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("[Fill in city or county and state]");
  });

  it("shows 'None.' when there are no modifications", () => {
    setup();
    expect(section("MNDA Modifications")).toHaveTextContent("None.");
  });

  it("renders the Common Paper attribution on both the cover page and the terms", () => {
    setup();
    const links = within(doc()).getAllByRole("link", { name: "CC BY 4.0" });
    expect(links).toHaveLength(2);
    links.forEach((a) => expect(a).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/"));
  });

  it("opens external links safely", () => {
    setup();
    for (const a of within(doc()).getAllByRole("link")) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("numbers the 11 standard terms clauses", () => {
    setup();
    expect(within(doc()).getAllByRole("listitem")).toHaveLength(11);
  });
});

describe("form -> document", () => {
  it("reflects agreement details", async () => {
    const user = setup();
    await user.clear(screen.getByLabelText("Purpose"));
    await user.type(screen.getByLabelText("Purpose"), "Exploring a joint venture.");
    fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2027-01-05" } });
    await user.type(screen.getByLabelText("Modifications"), "Section 3 is deleted.");

    expect(section("Purpose")).toHaveTextContent("Exploring a joint venture.");
    expect(section("Effective Date")).toHaveTextContent("January 5, 2027");
    expect(section("MNDA Modifications")).toHaveTextContent("Section 3 is deleted.");
    expect(section("MNDA Modifications")).not.toHaveTextContent("None.");
  });

  it("shows a placeholder when the purpose or date is cleared (no snap-back to defaults)", async () => {
    const user = setup();
    await user.clear(screen.getByLabelText("Purpose"));
    fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "" } });
    expect(section("Purpose")).toHaveTextContent("[Purpose]");
    expect(section("Effective Date")).toHaveTextContent("[Effective Date]");
    expect(screen.getByLabelText("Effective date")).toHaveValue("");
  });

  it("puts governing law and jurisdiction on the cover page and into the terms", async () => {
    const user = setup();
    await user.type(screen.getByLabelText("Governing law (state)"), "Delaware");
    await user.type(screen.getByLabelText("Jurisdiction (city or county and state)"), "New Castle, DE");

    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Governing Law: Delaware");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Jurisdiction: courts located in New Castle, DE");
    expect(doc()).toHaveTextContent("laws of the State of Delaware, without regard");
    expect(doc()).toHaveTextContent("courts located in New Castle, DE. Each party");
  });

  it("fills party details into the signature table and leaves signature/date blank", async () => {
    const user = setup();
    const p1 = within(group("Party 1"));
    const p2 = within(group("Party 2"));
    await user.type(p1.getByLabelText("Company"), "Acme Corp");
    await user.type(p1.getByLabelText("Signatory name"), "Jane Doe");
    await user.type(p1.getByLabelText("Title"), "CEO");
    await user.type(p1.getByLabelText("Notice address"), "jane@acme.com");
    await user.type(p2.getByLabelText("Company"), "Globex");
    await user.type(p2.getByLabelText("Signatory name"), "John Smith");

    const rows = within(within(doc()).getByRole("table")).getAllByRole("row");
    const cells = (label: string) =>
      within(rows.find((r) => within(r).queryByRole("rowheader", { name: new RegExp(`^${label}`) }))!)
        .getAllByRole("cell")
        .map((c) => c.textContent);
    expect(cells("Print Name")).toEqual(["Jane Doe", "John Smith"]);
    expect(cells("Title")).toEqual(["CEO", ""]);
    expect(cells("Company")).toEqual(["Acme Corp", "Globex"]);
    expect(cells("Notice Address")).toEqual(["jane@acme.com", ""]);
    expect(cells("Signature")).toEqual(["", ""]);
    expect(cells("Date")).toEqual(["", ""]);
  });

  it("keeps party 1 and party 2 independent", async () => {
    const user = setup();
    await user.type(within(group("Party 1")).getByLabelText("Company"), "Acme");
    expect(within(group("Party 2")).getByLabelText("Company")).toHaveValue("");
  });

  it("does not disturb other fields while typing in one", async () => {
    const user = setup();
    await user.type(screen.getByLabelText("Governing law (state)"), "Texas");
    await user.type(within(group("Party 1")).getByLabelText("Title"), "CTO");
    expect(screen.getByLabelText("Governing law (state)")).toHaveValue("Texas");
    expect(screen.getByLabelText("Purpose")).toHaveValue(
      "Evaluating whether to enter into a business relationship with the other party.",
    );
  });
});

describe("terms", () => {
  it("expires after N years by default and lets the user change N", async () => {
    const user = setup();
    const term = within(group("MNDA term"));
    expect(term.getByRole("radio", { name: "Expires after" })).toBeChecked();
    const years = term.getByLabelText("Number of years");
    await user.clear(years);
    await user.type(years, "3");
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Expires\ 3\ year\(s\)\ from\ Effective\ Date\./);
    expect(section("MNDA Term")).toHaveTextContent(/☐\s*Continues\ until\ terminated/);
  });

  it("switches to 'continues until terminated' and disables the years box", async () => {
    const user = setup();
    const term = within(group("MNDA term"));
    await user.click(term.getByRole("radio", { name: "Continues until terminated" }));
    expect(term.getByLabelText("Number of years")).toBeDisabled();
    expect(section("MNDA Term")).toHaveTextContent(/☐\s*Expires\ 1\ year\(s\)/);
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Continues\ until\ terminated\ in\ accordance\ with\ the\ terms\ of\ the\ MNDA\./);
    await user.click(term.getByRole("radio", { name: "Expires after" }));
    expect(term.getByLabelText("Number of years")).toBeEnabled();
  });

  it("remembers the years value when switching options and back", async () => {
    const user = setup();
    const term = within(group("MNDA term"));
    await user.clear(term.getByLabelText("Number of years"));
    await user.type(term.getByLabelText("Number of years"), "4");
    await user.click(term.getByRole("radio", { name: "Continues until terminated" }));
    await user.click(term.getByRole("radio", { name: "Expires after" }));
    expect(term.getByLabelText("Number of years")).toHaveValue(4);
  });

  it("switches confidentiality to perpetuity", async () => {
    const user = setup();
    const conf = within(group("Term of confidentiality"));
    await user.click(conf.getByRole("radio", { name: "In perpetuity" }));
    expect(conf.getByLabelText("Number of years")).toBeDisabled();
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*In\ perpetuity\./);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☐\s*1 year\(s\) from Effective Date/);
  });

  it("keeps the two radio groups independent", async () => {
    const user = setup();
    await user.click(within(group("MNDA term")).getByRole("radio", { name: "Continues until terminated" }));
    expect(within(group("Term of confidentiality")).getByRole("radio", { name: "Protected for" })).toBeChecked();
  });

  it("exposes the checked/unchecked state to assistive tech", () => {
    setup();
    const term = section("MNDA Term");
    expect(within(term).getAllByLabelText("Selected")).toHaveLength(1);
    expect(within(term).getAllByLabelText("Not selected")).toHaveLength(1);
  });
});

describe("hostile input is rendered as text", () => {
  it("does not create elements or links from markdown/HTML typed into governing law", async () => {
    setup();
    setValue("Governing law (state)", "<img src=x onerror=alert(1)> [pwn](javascript:alert(1)) **bold**");
    expect(doc().querySelector("img")).toBeNull();
    expect(doc().querySelector("script")).toBeNull();
    expect(within(doc()).queryByRole("link", { name: "pwn" })).toBeNull();
    expect(doc().querySelector('a[href^="javascript"]')).toBeNull();
    expect(doc()).toHaveTextContent("<img src=x onerror=alert(1)> [pwn](javascript:alert(1)) **bold**");
  });

  it("renders text typed into party and purpose fields literally", async () => {
    const user = setup();
    await user.type(within(group("Party 1")).getByLabelText("Company"), "<b>Acme</b> *Inc*");
    await user.clear(screen.getByLabelText("Purpose"));
    await user.type(screen.getByLabelText("Purpose"), "<i>x</i> **y**");
    expect(doc().querySelector("b, i")).toBeNull();
    expect(doc()).toHaveTextContent("<b>Acme</b> *Inc*");
    expect(doc()).toHaveTextContent("<i>x</i> **y**");
  });

  it("preserves line breaks in multi-line fields", async () => {
    const user = setup();
    await user.type(screen.getByLabelText("Modifications"), "Line one{Enter}Line two");
    expect(within(section("MNDA Modifications")).getByText(/Line one/)).toHaveClass("whitespace-pre-wrap");
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the print dialog", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("names the PDF after the agreement and the parties while printing", async () => {
    const user = setup();
    await user.type(within(group("Party 1")).getByLabelText("Company"), "Acme Corp");
    await user.type(within(group("Party 2")).getByLabelText("Company"), "Globex");
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(titleAtPrint).toEqual(["Mutual NDA - Acme Corp - Globex"]);
  });

  it("falls back to 'Mutual NDA' when no companies are entered and ignores blank ones", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(titleAtPrint).toEqual(["Mutual NDA"]);
    window.dispatchEvent(new Event("afterprint"));
    await user.type(within(group("Party 2")).getByLabelText("Company"), "Globex");
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(titleAtPrint.at(-1)).toBe("Mutual NDA - Globex");
  });

  it("restores the page title after printing", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Prelegal - Mutual NDA creator");
  });

  // Review-reported: the original title is captured per click, so if `afterprint` is missed once
  // the temporary title becomes the "original" and sticks. Remove `.fails` once fixed.
  it.fails("restores the original title even if afterprint never fired for an earlier click", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Prelegal - Mutual NDA creator");
  });
});

// Behaviours reported by the code review. `it.fails` passes while the defect exists and turns red once it is fixed,
// at which point the flag should be removed so these become ordinary regression tests.
describe("known defects (from review)", () => {
  it.fails("does not silently show 1 year when the years box is emptied", async () => {
    const user = setup();
    await user.clear(within(group("MNDA term")).getByLabelText("Number of years"));
    expect(section("MNDA Term")).not.toHaveTextContent("Expires 1 year(s)");
  });

  it.fails("does not silently turn 0 years into 1 year", async () => {
    const user = setup();
    const years = within(group("Term of confidentiality")).getByLabelText("Number of years");
    await user.clear(years);
    await user.type(years, "0");
    expect(section("Term of Confidentiality")).not.toHaveTextContent("1 year(s)");
  });

  it.fails("does not turn a URL typed into governing law into a live link", async () => {
    const user = setup();
    await user.type(screen.getByLabelText("Governing law (state)"), "www.example.com");
    expect(within(doc()).queryByRole("link", { name: "www.example.com" })).toBeNull();
  });

  it.fails("does not decode HTML entities typed into governing law", () => {
    setup();
    setValue("Governing law (state)", "AT&amp;T");
    const clause = within(doc())
      .getAllByRole("listitem")
      .find((li) => li.textContent?.trim().startsWith("Governing Law and Jurisdiction"))!;
    expect(clause).toHaveTextContent("State of AT&amp;T");
  });
});
