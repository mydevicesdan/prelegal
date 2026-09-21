import { describe, expect, it } from "vitest";
import { applyTurn, initialCreatorState, type CreatorState } from "@/lib/creator";
import { chatReply, ndaReply, noParty } from "./chatFixtures";

const state = (overrides: Partial<CreatorState> = {}): CreatorState => ({ ...initialCreatorState, ...overrides });

describe("applyTurn", () => {
  it("starts with no document, and a reply that changes nothing leaves that as it is", () => {
    expect(initialCreatorState.documentType).toBeNull();
    expect(applyTurn(initialCreatorState, chatReply("Tell me more."))).toEqual(initialCreatorState);
  });

  it("chooses the document", () => {
    expect(applyTurn(initialCreatorState, chatReply("A CSA.", { documentType: "csa" })).documentType).toBe("csa");
  });

  it("keeps the active document on a turn that does not name one", () => {
    expect(applyTurn(state({ documentType: "csa" }), chatReply("ok")).documentType).toBe("csa");
  });

  it("switches to another document without losing what was filled in", () => {
    const before = state({
      documentType: "csa",
      values: { "governing-law": "Delaware" },
      parties: { Provider: { company: "Acme", name: "", title: "", address: "" } },
    });
    const after = applyTurn(before, chatReply("Switching.", { documentType: "sla" }));
    expect(after.documentType).toBe("sla");
    expect(after.values).toEqual(before.values);
    expect(after.parties).toEqual(before.parties);
  });

  it("merges field values, letting a later value replace an earlier one", () => {
    let current = applyTurn(
      initialCreatorState,
      chatReply("a", {
        documentType: "csa",
        fieldValues: [
          { key: "governing-law", value: "Delaware" },
          { key: "chosen-courts", value: "Courts of New Castle" },
        ],
      }),
    );
    current = applyTurn(current, chatReply("b", { fieldValues: [{ key: "governing-law", value: "Ohio" }] }));
    expect(current.values).toEqual({ "governing-law": "Ohio", "chosen-courts": "Courts of New Castle" });
  });

  it("lets the assistant clear a value with an empty string", () => {
    const after = applyTurn(
      state({ values: { fees: "$5" } }),
      chatReply("cleared", { fieldValues: [{ key: "fees", value: "" }] }),
    );
    expect(after.values.fees).toBe("");
  });

  it("merges party details per role, keeping details the turn leaves null", () => {
    let current = applyTurn(
      initialCreatorState,
      chatReply("a", {
        parties: [
          { role: "Provider", ...noParty, company: "Acme", name: "Jane Doe" },
          { role: "Customer", ...noParty, company: "Globex" },
        ],
      }),
    );
    current = applyTurn(
      current,
      chatReply("b", { parties: [{ role: "Provider", ...noParty, title: "CEO", address: "jane@acme.com" }] }),
    );
    expect(current.parties).toEqual({
      Provider: { company: "Acme", name: "Jane Doe", title: "CEO", address: "jane@acme.com" },
      Customer: { company: "Globex", name: "", title: "", address: "" },
    });
  });

  it("applies Mutual NDA updates to the NDA state only", () => {
    const after = applyTurn(initialCreatorState, ndaReply("ok", { governingLaw: "Ohio", termYears: 3 }));
    expect(after.documentType).toBe("mutual-nda");
    expect(after.nda.governingLaw).toBe("Ohio");
    expect(after.nda.termYears).toBe("3");
    expect(after.values).toEqual({});
  });

  it("keeps the NDA fields when the user moves to another document and back", () => {
    let current = applyTurn(initialCreatorState, ndaReply("ok", { governingLaw: "Ohio" }));
    current = applyTurn(current, chatReply("csa", { documentType: "csa" }));
    current = applyTurn(current, chatReply("nda", { documentType: "mutual-nda" }));
    expect(current.nda.governingLaw).toBe("Ohio");
  });

  it("does not mutate the previous state", () => {
    const before = state({ values: { a: "1" }, parties: {} });
    const snapshot = structuredClone(before);
    applyTurn(before, chatReply("x", { fieldValues: [{ key: "a", value: "2" }], parties: [{ role: "Provider", ...noParty, company: "Acme" }] }));
    expect(before).toEqual(snapshot);
  });
});
