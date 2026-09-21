import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenericDocument } from "@/components/GenericDocument";
import type { DocumentSpec, FieldValues, PartiesByRole } from "@/lib/documents";
import { csaSpec } from "./chatFixtures";

const setup = (values: FieldValues = {}, parties: PartiesByRole = {}, spec: DocumentSpec = csaSpec) =>
  render(<GenericDocument spec={spec} values={values} parties={parties} />);

const doc = () => screen.getByRole("article");
const section = (heading: string) =>
  within(doc()).getByRole("heading", { name: heading }).closest("section") as HTMLElement;

const party = (details: Partial<PartiesByRole[string]>) => ({ company: "", name: "", title: "", address: "", ...details });

describe("front page", () => {
  it("is titled with the document name", () => {
    setup();
    expect(screen.getByRole("article", { name: "Cloud Service Agreement" })).toBeInTheDocument();
    expect(within(doc()).getByRole("heading", { level: 1, name: "Cloud Service Agreement" })).toBeInTheDocument();
  });

  it("shows a placeholder for every party and field that is not filled in yet", () => {
    setup();
    expect(section("Parties")).toHaveTextContent("Customer: [Customer company]");
    expect(section("Parties")).toHaveTextContent("Provider: [Provider company]");
    expect(section("Order Form")).toHaveTextContent("Subscription Period: [Subscription Period]");
    expect(section("Key Terms")).toHaveTextContent("Governing Law: [Governing Law]");
    expect(section("Key Terms")).toHaveTextContent("Chosen Courts: [Chosen Courts]");
  });

  it("groups the fields under the page they belong to, in order", () => {
    setup();
    const headings = within(doc()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Parties", "Order Form", "Key Terms"]);
  });

  it("shows the values and the party companies once they are known", () => {
    setup(
      { "subscription-period": "12 months from the Order Date", "governing-law": "Delaware" },
      { Provider: party({ company: "Acme Inc" }), Customer: party({ company: "Globex LLC" }) },
    );
    expect(section("Parties")).toHaveTextContent("Customer: Globex LLC");
    expect(section("Parties")).toHaveTextContent("Provider: Acme Inc");
    expect(section("Order Form")).toHaveTextContent("Subscription Period: 12 months from the Order Date");
    expect(section("Key Terms")).toHaveTextContent("Governing Law: Delaware");
    expect(section("Key Terms")).toHaveTextContent("Chosen Courts: [Chosen Courts]");
  });

  it("treats a blank value as not filled in", () => {
    setup({ "governing-law": "   " });
    expect(section("Key Terms")).toHaveTextContent("Governing Law: [Governing Law]");
  });

  it("preserves line breaks in values", () => {
    setup({ "subscription-period": "Year one\nYear two" });
    expect(within(section("Order Form")).getByText(/Year one/)).toHaveClass("whitespace-pre-wrap");
  });

  it("leaves out the fields of other documents", () => {
    setup({ "target-uptime": "99.9%" });
    expect(doc()).not.toHaveTextContent("99.9%");
  });
});

describe("signature block", () => {
  const cells = (label: string) => {
    const rows = within(within(doc()).getByRole("table")).getAllByRole("row");
    return within(rows.find((r) => within(r).queryByRole("rowheader", { name: new RegExp(`^${label}`) }))!)
      .getAllByRole("cell")
      .map((c) => c.textContent);
  };

  it("has a column per party role, in the document's order", () => {
    setup();
    const headers = within(within(doc()).getByRole("table")).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["", "CUSTOMER", "PROVIDER"]);
  });

  it("fills in the party details and leaves the signature and date blank", () => {
    setup(
      {},
      {
        Customer: party({ company: "Globex LLC", name: "John Smith", title: "CFO", address: "1 Main St" }),
        Provider: party({ company: "Acme Inc", name: "Jane Doe" }),
      },
    );
    expect(cells("Print Name")).toEqual(["John Smith", "Jane Doe"]);
    expect(cells("Title")).toEqual(["CFO", ""]);
    expect(cells("Company")).toEqual(["Globex LLC", "Acme Inc"]);
    expect(cells("Notice Address")).toEqual(["1 Main St", ""]);
    expect(cells("Signature")).toEqual(["", ""]);
    expect(cells("Date")).toEqual(["", ""]);
  });
});

describe("standard terms", () => {
  it("renders the terms with defined terms in bold and the clauses numbered", () => {
    setup();
    const terms = within(doc()).getByRole("heading", { name: "Standard Terms" }).closest("section") as HTMLElement;
    expect(within(terms).getByText("Governing Law").tagName).toBe("STRONG");
    expect(terms.querySelector(".legal-numbering")).not.toBeNull();
    expect(within(terms).getAllByRole("listitem")).toHaveLength(5); // 2 clauses and 3 sub-clauses
    expect(within(terms).getAllByRole("list")).toHaveLength(3); // the top level and one per clause
  });

  it("sets lettered sub-clauses out as their own paragraphs within their clause", () => {
    setup();
    const terms = within(doc()).getByRole("heading", { name: "Standard Terms" }).closest("section") as HTMLElement;
    const a = within(terms).getByText(/^a\. in every case;$/);
    const b = within(terms).getByText(/^b\. unless stated otherwise\.$/);
    expect(a.tagName).toBe("P");
    expect(b.tagName).toBe("P");
    expect(a).not.toBe(b);
    // They sit inside the clause they belong to (2.1), after its lead-in text.
    const clause = a.closest("li") as HTMLElement;
    expect(clause).toContainElement(b);
    expect(clause).toHaveTextContent(/^Law\.\s+The Governing Law applies:\s*a\. in every case;\s*b\. unless stated otherwise\.$/);
    expect(terms.querySelector("pre, code")).toBeNull();
  });

  it("does not render raw HTML from the terms", () => {
    setup({}, {}, { ...csaSpec, terms: "1. <img src=x onerror=alert(1)> **safe**" });
    expect(doc().querySelector("img")).toBeNull();
  });

  it("credits Common Paper under CC BY 4.0, with a safe link", () => {
    setup();
    const link = within(doc()).getByRole("link", { name: "CC BY 4.0" });
    expect(link).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(doc()).toHaveTextContent("Based on the Common Paper Cloud Service Agreement standard terms");
  });

  it("starts the terms on a new page when printed", () => {
    setup();
    const terms = within(doc()).getByRole("heading", { name: "Standard Terms" }).closest("section");
    expect(terms).toHaveClass("break-before-page");
  });
});

describe("hostile input is rendered as text", () => {
  it("does not create elements or links from markup in values or party details", () => {
    setup(
      { "governing-law": "<img src=x onerror=alert(1)> [pwn](javascript:alert(1)) **bold**" },
      { Provider: party({ company: "<b>Acme</b> *Inc*", name: "<script>alert(2)</script>" }) },
    );
    expect(doc().querySelector("img, script, b")).toBeNull();
    expect(within(doc()).queryByRole("link", { name: "pwn" })).toBeNull();
    expect(doc().querySelector('a[href^="javascript"]')).toBeNull();
    expect(doc()).toHaveTextContent("<img src=x onerror=alert(1)> [pwn](javascript:alert(1)) **bold**");
    expect(doc()).toHaveTextContent("<b>Acme</b> *Inc*");
  });
});
