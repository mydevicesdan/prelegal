import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { NdaDocument } from "@/components/NdaDocument";
import { initialFormState, type NdaFormData } from "@/lib/nda";
import { loadMutualNdaTemplates, type MutualNdaTemplates } from "@/lib/templates";

let templates: MutualNdaTemplates;

beforeAll(async () => {
  templates = await loadMutualNdaTemplates();
});

const baseData: NdaFormData = { ...initialFormState, effectiveDate: "2026-09-19" };

/** Renders the agreement for the given field values (everything else is the template default). */
const setup = (overrides: Partial<NdaFormData> = {}) =>
  render(<NdaDocument data={{ ...baseData, ...overrides }} templates={templates} />);

const doc = () => screen.getByRole("article");
const section = (heading: string) =>
  within(doc()).getByRole("heading", { name: heading }).closest("section") as HTMLElement;

describe("initial render", () => {
  it("shows the cover page and the standard terms", () => {
    setup();
    expect(within(doc()).getByRole("heading", { name: "Mutual Non-Disclosure Agreement" })).toBeInTheDocument();
    expect(within(doc()).getByRole("heading", { name: "Standard Terms" })).toBeInTheDocument();
  });

  it("shows the effective date", () => {
    setup();
    expect(section("Effective Date")).toHaveTextContent("September 19, 2026");
  });

  it("shows the template's default purpose, 1 year term and 1 year confidentiality", () => {
    setup();
    expect(section("Purpose")).toHaveTextContent(
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

describe("data -> document", () => {
  it("reflects agreement details", () => {
    setup({
      purpose: "Exploring a joint venture.",
      effectiveDate: "2027-01-05",
      modifications: "Section 3 is deleted.",
    });
    expect(section("Purpose")).toHaveTextContent("Exploring a joint venture.");
    expect(section("Effective Date")).toHaveTextContent("January 5, 2027");
    expect(section("MNDA Modifications")).toHaveTextContent("Section 3 is deleted.");
    expect(section("MNDA Modifications")).not.toHaveTextContent("None.");
  });

  it("shows a placeholder when the purpose or date is empty (no snap-back to defaults)", () => {
    setup({ purpose: "", effectiveDate: "" });
    expect(section("Purpose")).toHaveTextContent("[Purpose]");
    expect(section("Effective Date")).toHaveTextContent("[Effective Date]");
  });

  it("puts governing law and jurisdiction on the cover page and into the terms", () => {
    setup({ governingLaw: "Delaware", jurisdiction: "New Castle, DE" });
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Governing Law: Delaware");
    expect(section("Governing Law & Jurisdiction")).toHaveTextContent("Jurisdiction: courts located in New Castle, DE");
    expect(doc()).toHaveTextContent("laws of the State of Delaware, without regard");
    expect(doc()).toHaveTextContent("courts located in New Castle, DE. Each party");
  });

  it("fills party details into the signature table and leaves signature/date blank", () => {
    setup({
      party1: { company: "Acme Corp", name: "Jane Doe", title: "CEO", address: "jane@acme.com" },
      party2: { company: "Globex", name: "John Smith", title: "", address: "" },
    });

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
});

describe("terms", () => {
  it("expires after N years", () => {
    setup({ termType: "expires", termYears: "3" });
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Expires\ 3\ year\(s\)\ from\ Effective\ Date\./);
    expect(section("MNDA Term")).toHaveTextContent(/☐\s*Continues\ until\ terminated/);
  });

  it("continues until terminated", () => {
    setup({ termType: "continues", termYears: "5" });
    expect(section("MNDA Term")).toHaveTextContent(/☐\s*Expires\ 5\ year\(s\)/);
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Continues\ until\ terminated\ in\ accordance\ with\ the\ terms\ of\ the\ MNDA\./);
  });

  it("protects confidentiality for N years", () => {
    setup({ confidentialityType: "years", confidentialityYears: "4" });
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*4 year\(s\) from Effective Date/);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☐\s*In\ perpetuity\./);
  });

  it("protects confidentiality in perpetuity", () => {
    setup({ confidentialityType: "perpetuity" });
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*In\ perpetuity\./);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☐\s*1 year\(s\) from Effective Date/);
  });

  it("keeps the two choices independent", () => {
    setup({ termType: "continues", confidentialityType: "years" });
    expect(section("MNDA Term")).toHaveTextContent(/☒\s*Continues/);
    expect(section("Term of Confidentiality")).toHaveTextContent(/☒\s*1 year\(s\) from Effective Date/);
  });

  it("exposes the checked/unchecked state to assistive tech", () => {
    setup();
    const term = section("MNDA Term");
    expect(within(term).getAllByLabelText("Selected")).toHaveLength(1);
    expect(within(term).getAllByLabelText("Not selected")).toHaveLength(1);
  });
});

describe("hostile input is rendered as text", () => {
  it("does not create elements or links from markdown/HTML in governing law", () => {
    setup({ governingLaw: "<img src=x onerror=alert(1)> [pwn](javascript:alert(1)) **bold**" });
    expect(doc().querySelector("img")).toBeNull();
    expect(doc().querySelector("script")).toBeNull();
    expect(within(doc()).queryByRole("link", { name: "pwn" })).toBeNull();
    expect(doc().querySelector('a[href^="javascript"]')).toBeNull();
    expect(doc()).toHaveTextContent("<img src=x onerror=alert(1)> [pwn](javascript:alert(1)) **bold**");
  });

  it("renders text in party and purpose fields literally", () => {
    setup({
      purpose: "<i>x</i> **y**",
      party1: { company: "<b>Acme</b> *Inc*", name: "", title: "", address: "" },
    });
    expect(doc().querySelector("b, i")).toBeNull();
    expect(doc()).toHaveTextContent("<b>Acme</b> *Inc*");
    expect(doc()).toHaveTextContent("<i>x</i> **y**");
  });

  it("preserves line breaks in multi-line fields", () => {
    setup({ modifications: "Line one\nLine two" });
    expect(within(section("MNDA Modifications")).getByText(/Line one/)).toHaveClass("whitespace-pre-wrap");
  });
});

// Behaviours reported by the code review. `it.fails` passes while the defect exists and turns red once it is fixed,
// at which point the flag should be removed so these become ordinary regression tests.
describe("known defects (from review)", () => {
  it.fails("does not turn a URL in governing law into a live link", () => {
    setup({ governingLaw: "www.example.com" });
    expect(within(doc()).queryByRole("link", { name: "www.example.com" })).toBeNull();
  });

  it.fails("does not decode HTML entities in governing law", () => {
    setup({ governingLaw: "AT&amp;T" });
    const clause = within(doc())
      .getAllByRole("listitem")
      .find((li) => li.textContent?.trim().startsWith("Governing Law and Jurisdiction"))!;
    expect(clause).toHaveTextContent("State of AT&amp;T");
  });
});
