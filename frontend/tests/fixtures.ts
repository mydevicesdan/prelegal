// Pure test data shared by the unit tests (Vitest) and the e2e tests (Playwright): no test-runner imports here.
import type { NdaUpdates, PartyUpdate } from "@/lib/chat";
import type { DocumentSpec } from "@/lib/documents";

export const noParty: PartyUpdate = { company: null, name: null, title: null, address: null };

export const noUpdates: NdaUpdates = {
  purpose: null,
  effectiveDate: null,
  termType: null,
  termYears: null,
  confidentialityType: null,
  confidentialityYears: null,
  governingLaw: null,
  jurisdiction: null,
  modifications: null,
  party1: noParty,
  party2: noParty,
};

/** Small stand-ins for what GET /api/documents/{key} returns, in the same shape as the real specs. */
export const csaSpec: DocumentSpec = {
  key: "csa",
  name: "Cloud Service Agreement",
  parties: ["Customer", "Provider"],
  fields: [
    { key: "subscription-period", label: "Subscription Period", source: "orderform", context: "During the Subscription Period, Customer may use it." },
    { key: "governing-law", label: "Governing Law", source: "keyterms", context: "The Governing Law applies." },
    { key: "chosen-courts", label: "Chosen Courts", source: "keyterms", context: "Disputes go to the Chosen Courts." },
  ],
  terms:
    "1. **Service**\n    1. **Access.**  During the **Subscription Period**, **Customer** may use it.\n" +
    "2. **General**\n    1. **Law.**  The **Governing Law** applies:\n\n       a. in every case;\n\n       b. unless stated otherwise.\n    2. **Courts.**  Disputes go to the **Chosen Courts**.",
};

export const slaSpec: DocumentSpec = {
  key: "sla",
  name: "Service Level Agreement",
  parties: ["Provider", "Customer"],
  fields: [
    { key: "target-uptime", label: "Target Uptime", source: "orderform", context: "Provider will meet the Target Uptime." },
    { key: "subscription-period", label: "Subscription Period", source: "orderform", context: "Across the Subscription Period." },
  ],
  terms: "1. **Uptime**\n    1. **Target.**  **Provider** will meet the **Target Uptime**.",
};

export const specFixtures: Record<string, DocumentSpec> = { csa: csaSpec, sla: slaSpec };
