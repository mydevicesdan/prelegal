import { afterEach, describe, expect, it, vi } from "vitest";
import { applyUpdates, sendChat, toWireFields } from "@/lib/chat";
import { initialFormState, type NdaFormData, type NdaFormState } from "@/lib/nda";
import { chatReply, mockChatApi, noParty, noUpdates, requestBody } from "./chatFixtures";

afterEach(() => vi.unstubAllGlobals());

const state = (overrides: Partial<NdaFormState> = {}): NdaFormState => ({
  ...initialFormState,
  ...overrides,
});

describe("applyUpdates", () => {
  it("leaves everything unchanged when every update is null", () => {
    const before = state({ governingLaw: "Ohio", party1: { company: "Acme", name: "", title: "", address: "" } });
    expect(applyUpdates(before, noUpdates)).toEqual(before);
  });

  it("applies the fields the assistant provides", () => {
    const after = applyUpdates(state(), {
      ...noUpdates,
      purpose: "Exploring a joint venture.",
      effectiveDate: "2027-01-05",
      termType: "continues",
      termYears: 3,
      confidentialityType: "perpetuity",
      confidentialityYears: 5,
      governingLaw: "Delaware",
      jurisdiction: "New Castle, DE",
      modifications: "Section 3 is deleted.",
    });
    expect(after).toMatchObject({
      purpose: "Exploring a joint venture.",
      effectiveDate: "2027-01-05",
      termType: "continues",
      termYears: "3",
      confidentialityType: "perpetuity",
      confidentialityYears: "5",
      governingLaw: "Delaware",
      jurisdiction: "New Castle, DE",
      modifications: "Section 3 is deleted.",
    });
  });

  it("merges party details without touching the other fields or the other party", () => {
    const before = state({
      party1: { company: "Acme", name: "Jane", title: "", address: "" },
      party2: { company: "Globex", name: "", title: "", address: "" },
    });
    const after = applyUpdates(before, {
      ...noUpdates,
      party1: { ...noParty, title: "CEO", address: "jane@acme.com" },
    });
    expect(after.party1).toEqual({ company: "Acme", name: "Jane", title: "CEO", address: "jane@acme.com" });
    expect(after.party2).toEqual(before.party2);
  });

  it("lets the assistant clear modifications with an empty string", () => {
    expect(applyUpdates(state({ modifications: "x" }), { ...noUpdates, modifications: "" }).modifications).toBe("");
  });

  it.each(["next Friday", "2027-1-5", "01/05/2027", ""])("ignores the unusable date %j", (bad) => {
    expect(applyUpdates(state({ effectiveDate: "2026-01-01" }), { ...noUpdates, effectiveDate: bad }).effectiveDate).toBe(
      "2026-01-01",
    );
  });

  it.each([0, -2, 1.5, Number.NaN])("ignores the unusable year count %s", (bad) => {
    const after = applyUpdates(state({ termYears: "2", confidentialityYears: "4" }), {
      ...noUpdates,
      termYears: bad,
      confidentialityYears: bad,
    });
    expect(after.termYears).toBe("2");
    expect(after.confidentialityYears).toBe("4");
  });

  it("keeps the effective date unset (today) when the assistant does not set one", () => {
    expect(applyUpdates(state(), noUpdates).effectiveDate).toBeNull();
  });

  it("does not mutate the previous state", () => {
    const before = state();
    const snapshot = structuredClone(before);
    applyUpdates(before, { ...noUpdates, governingLaw: "Ohio", party1: { ...noParty, company: "Acme" } });
    expect(before).toEqual(snapshot);
  });
});

describe("toWireFields", () => {
  const data: NdaFormData = {
    ...initialFormState,
    effectiveDate: "2026-09-20",
    termYears: "2",
    confidentialityYears: "",
    governingLaw: "  ",
    party1: { company: "Acme", name: "", title: "", address: "" },
  };

  it("sends empty and blank fields as null and years as numbers", () => {
    expect(toWireFields(data)).toEqual({
      ...noUpdates,
      purpose: initialFormState.purpose,
      effectiveDate: "2026-09-20",
      termType: "expires",
      termYears: 2,
      confidentialityType: "years",
      confidentialityYears: null,
      party1: { ...noParty, company: "Acme" },
    });
  });
});

describe("sendChat", () => {
  const messages = [{ role: "user" as const, content: "Hi" }];
  const data: NdaFormData = { ...initialFormState, effectiveDate: "2026-09-20" };

  it("posts the conversation and current fields to /api/chat and returns the reply", async () => {
    const fetchMock = mockChatApi(chatReply("Hello!", { governingLaw: "Ohio" }));
    const result = await sendChat(messages, data);

    expect(result.reply).toBe("Hello!");
    expect(result.updates.governingLaw).toBe("Ohio");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(requestBody(fetchMock)).toEqual({ messages, fields: toWireFields(data) });
  });

  it("sends only the most recent 50 messages, each within 4000 characters", async () => {
    const fetchMock = mockChatApi(chatReply("ok"));
    const history = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? ("assistant" as const) : ("user" as const),
      content: i === 59 ? "y".repeat(5000) : `message ${i}`,
    }));
    await sendChat(history, data);

    const sent = requestBody(fetchMock).messages;
    expect(sent).toHaveLength(50);
    expect(sent[0].content).toBe("message 10");
    expect(sent.at(-1).role).toBe("user");
    expect(sent.at(-1).content).toHaveLength(4000);
  });

  it("explains a rejected message instead of showing a generic error", async () => {
    mockChatApi({ status: 422, body: { detail: [{ msg: "too long" }] } });
    await expect(sendChat(messages, data)).rejects.toThrow("Please shorten it");
  });

  it("surfaces the server's error message", async () => {
    mockChatApi({ status: 503, body: { detail: "The AI assistant is not configured." } });
    await expect(sendChat(messages, data)).rejects.toThrow("The AI assistant is not configured.");
  });

  it("uses a generic message when the error has no usable detail", async () => {
    mockChatApi({ status: 500, body: { detail: [{ msg: "bad" }] } });
    await expect(sendChat(messages, data)).rejects.toThrow("Something went wrong. Please try again.");
  });

  it("uses a generic message when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 500 })));
    await expect(sendChat(messages, data)).rejects.toThrow("Something went wrong. Please try again.");
  });

  it("reports network failures", async () => {
    mockChatApi(new TypeError("Failed to fetch"));
    await expect(sendChat(messages, data)).rejects.toThrow("Could not reach the server");
  });
});
