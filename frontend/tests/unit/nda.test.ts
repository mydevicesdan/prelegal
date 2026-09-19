import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  fillStandardTerms,
  formatDate,
  formatYears,
  initialFormState,
  todayIso,
  type NdaFormData,
} from "@/lib/nda";
import { loadMutualNdaTemplates } from "@/lib/templates";

const baseData: NdaFormData = {
  ...initialFormState,
  effectiveDate: "2026-09-19",
};

const withData = (patch: Partial<NdaFormData>): NdaFormData => ({
  ...baseData,
  ...patch,
});

describe("formatDate", () => {
  it("formats an ISO date as a long US date", () => {
    expect(formatDate("2026-09-19")).toBe("September 19, 2026");
  });

  it("does not zero-pad the day", () => {
    expect(formatDate("2026-01-05")).toBe("January 5, 2026");
  });

  it("handles every month", () => {
    const names = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    names.forEach((name, i) => {
      const month = String(i + 1).padStart(2, "0");
      expect(formatDate(`2026-${month}-15`)).toBe(`${name} 15, 2026`);
    });
  });

  it("does not shift the day across timezones", () => {
    const original = process.env.TZ;
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      process.env.TZ = tz;
      expect(formatDate("2026-03-01")).toBe("March 1, 2026");
      expect(formatDate("2026-12-31")).toBe("December 31, 2026");
    }
    process.env.TZ = original;
  });

  it("returns an empty string for anything that is not yyyy-mm-dd", () => {
    for (const bad of ["", "2026-9-19", "19/09/2026", "not a date", "2026-09-19T00:00", "2026-13-01", "2026-00-10"]) {
      expect(formatDate(bad), `input: ${JSON.stringify(bad)}`).toBe("");
    }
  });

  // Documents current behaviour: the format is checked, the calendar is not.
  it("does not validate the day of the month", () => {
    expect(formatDate("2026-02-31")).toBe("February 31, 2026");
  });
});

describe("formatYears", () => {
  it("uses the template's 'year(s)' wording", () => {
    expect(formatYears("1")).toBe("1 year(s)");
    expect(formatYears("5")).toBe("5 year(s)");
    expect(formatYears("10")).toBe("10 year(s)");
  });

  it("falls back to 1 for blank, zero, negative or non-numeric input", () => {
    for (const bad of ["", " ", "0", "-3", "abc", "NaN", "Infinity"]) {
      expect(formatYears(bad), `input: ${JSON.stringify(bad)}`).toBe("1 year(s)");
    }
  });

  it("truncates decimals", () => {
    expect(formatYears("2.9")).toBe("2 year(s)");
  });

  it("tolerates surrounding whitespace", () => {
    expect(formatYears(" 3 ")).toBe("3 year(s)");
  });
});

describe("todayIso", () => {
  it("returns a zero-padded local yyyy-mm-dd date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59)); // local time: 5 Jan 2026
    expect(todayIso()).toBe("2026-01-05");
    vi.setSystemTime(new Date(2026, 11, 31, 0, 0)); // local time: 31 Dec 2026
    expect(todayIso()).toBe("2026-12-31");
    vi.useRealTimers();
  });
});

describe("fillStandardTerms (real template)", () => {
  let terms: string;

  beforeAll(async () => {
    terms = (await loadMutualNdaTemplates()).standardTerms;
  });

  it("leaves no raw span markup behind", () => {
    const filled = fillStandardTerms(terms, withData({ governingLaw: "Delaware", jurisdiction: "New Castle, DE" }));
    expect(filled).not.toContain("<span");
    expect(filled).not.toContain("coverpage_link");
  });

  it("fills Governing Law at its first use and keeps later uses as the defined term", () => {
    const filled = fillStandardTerms(terms, withData({ governingLaw: "Delaware" }));
    expect(filled).toContain("the laws of the State of **Delaware**, without regard");
    expect(filled).toContain("conflict of laws provisions of such **Governing Law**");
    expect(filled.match(/\*\*Delaware\*\*/g)).toHaveLength(1);
  });

  it("fills Jurisdiction at its first use and keeps later uses as the defined term", () => {
    const filled = fillStandardTerms(terms, withData({ jurisdiction: "New Castle, DE" }));
    expect(filled).toContain("state courts located in **New Castle, DE**.");
    expect(filled).toContain("exclusive jurisdiction of such **Jurisdiction**");
    expect(filled.match(/New Castle, DE/g)).toHaveLength(1);
  });

  it("keeps the field name as a bold defined term when the value is blank or whitespace", () => {
    for (const blank of ["", "   ", "\n\t"]) {
      const filled = fillStandardTerms(terms, withData({ governingLaw: blank, jurisdiction: blank }));
      expect(filled).toContain("the State of **Governing Law**");
      expect(filled).toContain("courts located in **Jurisdiction**");
    }
  });

  it("trims the values it fills in", () => {
    const filled = fillStandardTerms(terms, withData({ governingLaw: "  Delaware  " }));
    expect(filled).toContain("State of **Delaware**,");
  });

  it("never substitutes values for Purpose, Effective Date, MNDA Term or Term of Confidentiality", () => {
    const filled = fillStandardTerms(
      terms,
      withData({ purpose: "SECRET-PURPOSE", termYears: "77", confidentialityYears: "88" }),
    );
    expect(filled).not.toContain("SECRET-PURPOSE");
    expect(filled).not.toContain("2026");
    expect(filled).not.toContain("77");
    expect(filled).not.toContain("88");
    expect(filled).toContain("**Purpose**");
    expect(filled).toContain("**Effective Date**");
    expect(filled).toContain("**MNDA Term**");
    expect(filled).toContain("**Term of Confidentiality**");
  });

  it("does not change any other template text", () => {
    const filled = fillStandardTerms(terms, baseData);
    const stripped = (s: string) => s.replace(/<span class="coverpage_link">([^<]+)<\/span>|\*\*([^*]+)\*\*/g, "$1$2");
    expect(stripped(filled)).toBe(stripped(terms));
  });

  it("preserves all 11 numbered clauses", () => {
    const filled = fillStandardTerms(terms, baseData);
    for (let n = 1; n <= 11; n++) {
      expect(filled).toMatch(new RegExp(`^${n}\\. \\*\\*`, "m"));
    }
  });
});

describe("fillStandardTerms (markdown safety)", () => {
  const terms = 'State of <span class="coverpage_link">Governing Law</span>.';

  it.each([
    ["bold", "**pwn**", "\\*\\*pwn\\*\\*"],
    ["italics", "_x_", "\\_x\\_"],
    ["link", "[click](https://evil.example)", "\\[click\\]\\(https://evil.example\\)"],
    ["image", "![x](https://evil.example/a.png)", "\\!\\[x\\]\\(https://evil.example/a.png\\)"],
    ["heading", "# Title", "\\# Title"],
    ["code", "`code`", "\\`code\\`"],
    ["strikethrough", "~~gone~~", "\\~\\~gone\\~\\~"],
    ["table pipe", "a | b", "a \\| b"],
    ["html", "<script>alert(1)</script>", "\\<script\\>alert\\(1\\)\\</script\\>"],
    ["backslash", "back\\slash", "back\\\\slash"],
    ["list marker", "- item", "\\- item"],
  ])("escapes %s", (_name, input, expected) => {
    const filled = fillStandardTerms(terms, withData({ governingLaw: input }));
    expect(filled).toBe(`State of **${expected}**.`);
  });

  it("cannot smuggle in a second coverpage span", () => {
    const filled = fillStandardTerms(
      'A <span class="coverpage_link">Governing Law</span> B <span class="coverpage_link">Jurisdiction</span>',
      withData({
        governingLaw: '<span class="coverpage_link">Jurisdiction</span>',
        jurisdiction: "Texas",
      }),
    );
    // Any "<" that survives must be backslash-escaped, so it renders as text.
    expect(filled).not.toMatch(/(?<!\\)</);
    expect(filled).toContain("**Texas**");
  });

  it("handles unicode and emoji values untouched", () => {
    const filled = fillStandardTerms(terms, withData({ governingLaw: "Zürich 🇨🇭" }));
    expect(filled).toBe("State of **Zürich 🇨🇭**.");
  });

  it("does not treat `$&`-style replacement patterns in user input specially", () => {
    const filled = fillStandardTerms(terms, withData({ governingLaw: "$& $1 $$ $`" }));
    expect(filled).toContain("$& $1 $$ $`".replace(/`/g, "\\`"));
  });
});
