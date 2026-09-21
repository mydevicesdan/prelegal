import { afterEach, describe, expect, it, vi } from "vitest";
import { initialCreatorState, type CreatorState } from "@/lib/creator";
import {
  createDraft,
  deleteDraft,
  draftCompanies,
  getDraft,
  listDrafts,
  parseCreatorState,
  parseMessages,
  saveDraft,
  toDraftPayload,
} from "@/lib/drafts";
import { initialFormState } from "@/lib/nda";
import { csaSpec, draftCalls, mockChatApi } from "./chatFixtures";

afterEach(() => vi.unstubAllGlobals());

const party = (company: string) => ({ company, name: "", title: "", address: "" });
const state = (overrides: Partial<CreatorState> = {}): CreatorState => ({ ...initialCreatorState, ...overrides });

describe("draftCompanies", () => {
  it("lists the NDA's two companies, leaving out blank ones", () => {
    const nda = { ...initialFormState, party1: party(" Acme "), party2: party("  ") };
    expect(draftCompanies(state({ documentType: "mutual-nda", nda }))).toEqual(["Acme"]);
  });

  it("follows the document's role order once its details are known", () => {
    const parties = { Provider: party("Acme"), Customer: party("Globex") };
    expect(draftCompanies(state({ documentType: "csa", parties }), csaSpec)).toEqual(["Globex", "Acme"]);
  });

  it("uses whoever has been named while the details are still loading", () => {
    const parties = { Provider: party("Acme"), Customer: party("") };
    expect(draftCompanies(state({ documentType: "csa", parties }))).toEqual(["Acme"]);
  });

  it("ignores roles the document does not have", () => {
    expect(draftCompanies(state({ documentType: "csa", parties: { Partner: party("Nope") } }), csaSpec)).toEqual([]);
  });
});

describe("toDraftPayload", () => {
  it("bundles the document, its companies, the state and the conversation", () => {
    const current = state({ documentType: "csa", parties: { Provider: party("Acme") } });
    const messages = [{ role: "user" as const, content: "hi" }];
    expect(toDraftPayload(current, messages, csaSpec)).toEqual({
      documentType: "csa",
      companies: ["Acme"],
      state: current,
      messages,
    });
  });

  it("keeps a very long conversation within what the server accepts, so saving never fails for good", () => {
    const messages = Array.from({ length: 250 }, (_, i) => ({
      role: i % 2 ? ("user" as const) : ("assistant" as const),
      content: i === 249 ? "z".repeat(9000) : `m${i}`,
    }));
    const saved = toDraftPayload(state({ documentType: "csa" }), messages, csaSpec).messages;
    expect(saved).toHaveLength(200);
    expect(saved[0]!.content).toBe("m50"); // the most recent are kept
    expect(saved.at(-1)!.content).toHaveLength(4000);
  });

  it("never lists more companies than the server accepts, or names longer than it accepts", () => {
    const parties = Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((r) => [r, party(r === "A" ? "x".repeat(300) : r)]));
    const companies = draftCompanies(state({ documentType: "csa", parties }));
    expect(companies).toHaveLength(4);
    expect(companies[0]).toHaveLength(200);
  });

  it("dates an NDA nobody dated on the day it was drafted, so it is the same when reopened", () => {
    const current = state({ documentType: "mutual-nda", nda: { ...initialFormState, effectiveDate: null } });
    const payload = toDraftPayload(current, [], undefined, "2026-09-20");
    expect(payload.state.nda.effectiveDate).toBe("2026-09-20");
    expect(current.nda.effectiveDate).toBeNull(); // what is on screen is untouched
  });

  it("leaves a chosen date, and other documents, alone", () => {
    const dated = state({ documentType: "mutual-nda", nda: { ...initialFormState, effectiveDate: "2026-01-02" } });
    expect(toDraftPayload(dated, [], undefined, "2026-09-20").state.nda.effectiveDate).toBe("2026-01-02");
    const csa = state({ documentType: "csa" });
    expect(toDraftPayload(csa, [], csaSpec, "2026-09-20").state).toBe(csa);
  });
});

describe("parseCreatorState", () => {
  it("round-trips a real state", () => {
    const current = state({
      documentType: "csa",
      values: { "governing-law": "Delaware" },
      parties: { Provider: party("Acme") },
      nda: { ...initialFormState, governingLaw: "Ohio", termType: "continues", effectiveDate: "2027-01-05" },
    });
    expect(parseCreatorState(JSON.parse(JSON.stringify(current)))).toEqual(current);
  });

  it.each([null, undefined, "text", 42, [], true])("falls back to a blank state for %j", (raw) => {
    expect(parseCreatorState(raw)).toEqual(initialCreatorState);
  });

  it("fills what is missing with blanks and the NDA's defaults", () => {
    const parsed = parseCreatorState({ documentType: "sla" });
    expect(parsed).toEqual({ ...initialCreatorState, documentType: "sla" });
    expect(parsed.nda.purpose).toBe(initialFormState.purpose);
  });

  it("drops values of the wrong type instead of trusting them", () => {
    const parsed = parseCreatorState({
      documentType: 5,
      values: { good: "yes", bad: 3, worse: { x: 1 } },
      parties: { Provider: { company: "Acme", name: 7 }, Customer: "not an object" },
      nda: { purpose: 1, governingLaw: ["x"], termType: "sometimes", confidentialityType: "eternity", termYears: 3 },
    });
    expect(parsed.documentType).toBeNull();
    expect(parsed.values).toEqual({ good: "yes" });
    expect(parsed.parties).toEqual({ Provider: party("Acme"), Customer: party("") });
    expect(parsed.nda).toMatchObject({
      purpose: initialFormState.purpose,
      governingLaw: "",
      termType: "expires",
      confidentialityType: "years",
      termYears: initialFormState.termYears,
    });
  });
});

describe("parseMessages", () => {
  it("keeps well-formed messages in order", () => {
    const messages = [
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Hi" },
    ];
    expect(parseMessages(messages)).toEqual(messages);
  });

  it("drops anything malformed", () => {
    expect(
      parseMessages([
        { role: "system", content: "no" },
        { role: "user" },
        { role: "user", content: 5 },
        null,
        "text",
        { role: "user", content: "keep me", extra: true },
      ]),
    ).toEqual([{ role: "user", content: "keep me" }]);
  });

  it.each([null, undefined, {}, "text"])("is empty for %j", (raw) => {
    expect(parseMessages(raw)).toEqual([]);
  });
});

describe("the drafts API", () => {
  const payload = toDraftPayload(state({ documentType: "csa" }), [{ role: "user", content: "hi" }], csaSpec);

  it("creates, reads, lists, saves and deletes", async () => {
    const backend = mockChatApi();
    const created = await createDraft(payload);
    expect(created).toMatchObject({ id: 1, documentType: "csa", documentName: "Cloud Service Agreement" });

    expect(await getDraft(1)).toMatchObject({ id: 1, messages: payload.messages });
    expect((await listDrafts()).map((d) => d.id)).toEqual([1]);
    expect(await saveDraft(1, { ...payload, companies: ["Acme"] })).toMatchObject({ companies: ["Acme"] });
    expect(await deleteDraft(1)).toBeUndefined();
    expect(await listDrafts()).toEqual([]);

    expect(draftCalls(backend).map((c) => c.request)).toEqual([
      "POST /api/drafts",
      "GET /api/drafts/1",
      "GET /api/drafts",
      "PUT /api/drafts/1",
      "DELETE /api/drafts/1",
      "GET /api/drafts",
    ]);
  });

  it("rejects when the draft does not exist", async () => {
    mockChatApi();
    await expect(getDraft(99)).rejects.toMatchObject({ status: 404 });
  });
});
