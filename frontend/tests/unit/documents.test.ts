import { afterEach, describe, expect, it, vi } from "vitest";
import { documentTitle, fetchDocumentSpec, groupFields, progress, type DocumentSpec } from "@/lib/documents";
import { csaSpec, documentCalls, mockChatApi } from "./chatFixtures";

afterEach(() => vi.unstubAllGlobals());

const spec = (fields: DocumentSpec["fields"]): DocumentSpec => ({ ...csaSpec, fields });
const field = (key: string, source: string) => ({ key, label: key, source, context: "" });

describe("groupFields", () => {
  it("groups fields by the page they belong to, in reading order", () => {
    const groups = groupFields(
      spec([
        field("law", "keyterms"),
        field("fees", "sow"),
        field("intro", "coverpage"),
        field("period", "orderform"),
        field("scope", "businessterms"),
        field("courts", "keyterms"),
      ]),
    );
    expect(groups.map((g) => g.title)).toEqual([
      "Cover Page",
      "Order Form",
      "Statement of Work",
      "Business Terms",
      "Key Terms",
    ]);
    expect(groups.at(-1)?.fields.map((f) => f.key)).toEqual(["law", "courts"]);
  });

  it("leaves out pages that have no fields", () => {
    expect(groupFields(spec([field("law", "keyterms")])).map((g) => g.title)).toEqual(["Key Terms"]);
    expect(groupFields(spec([]))).toEqual([]);
  });
});

describe("progress", () => {
  it("counts the fields that have a non-blank value", () => {
    expect(progress(csaSpec, {})).toEqual({ filled: 0, total: 3 });
    expect(
      progress(csaSpec, { "governing-law": "Delaware", "chosen-courts": "   ", "subscription-period": "1 year" }),
    ).toEqual({ filled: 2, total: 3 });
  });

  it("ignores values that belong to other documents", () => {
    expect(progress(csaSpec, { "target-uptime": "99.9%" })).toEqual({ filled: 0, total: 3 });
  });
});

describe("documentTitle", () => {
  const party = (company: string) => ({ company, name: "", title: "", address: "" });

  it("names the PDF after the document and the parties, in the document's role order", () => {
    expect(documentTitle(csaSpec, { Provider: party("Acme"), Customer: party("Globex") })).toBe(
      "Cloud Service Agreement - Globex - Acme",
    );
  });

  it("ignores blank and missing parties", () => {
    expect(documentTitle(csaSpec, { Provider: party("  ") })).toBe("Cloud Service Agreement");
    expect(documentTitle(csaSpec, { Provider: party("Acme") })).toBe("Cloud Service Agreement - Acme");
  });
});

describe("fetchDocumentSpec", () => {
  it("loads the spec from the backend", async () => {
    const fetchMock = mockChatApi();
    expect(await fetchDocumentSpec("csa")).toEqual(csaSpec);
    expect(documentCalls(fetchMock)).toEqual(["/api/documents/csa"]);
  });

  it("reports an unknown document", async () => {
    mockChatApi();
    await expect(fetchDocumentSpec("nope")).rejects.toThrow("Could not load the document");
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchDocumentSpec("csa")).rejects.toThrow("Could not reach the server");
  });

  it("escapes the key in the URL", async () => {
    const fetchMock = mockChatApi();
    await fetchDocumentSpec("../x").catch(() => undefined);
    expect(documentCalls(fetchMock)).toEqual(["/api/documents/..%2Fx"]);
  });
});
