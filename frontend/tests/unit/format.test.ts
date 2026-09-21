import { describe, expect, it } from "vitest";
import { fullDateTime, relativeTime } from "@/lib/format";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it.each([
    [0, "just now"],
    [30_000, "just now"],
    [MINUTE, "1 minute ago"],
    [5 * MINUTE, "5 minutes ago"],
    [59 * MINUTE, "59 minutes ago"],
    [HOUR, "1 hour ago"],
    [3 * HOUR, "3 hours ago"],
    [23 * HOUR, "23 hours ago"],
    [DAY, "yesterday"],
    [47 * HOUR, "yesterday"],
    [2 * DAY, "2 days ago"],
    [6 * DAY, "6 days ago"],
  ])("%d ms ago reads %j", (elapsed, expected) => {
    expect(relativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it("gives a date for anything older than a week", () => {
    expect(relativeTime("2026-09-01T09:00:00.000Z", NOW)).toBe("Sep 1, 2026");
  });

  it("does not go negative for a time slightly in the future", () => {
    expect(relativeTime(new Date(NOW + 5000).toISOString(), NOW)).toBe("just now");
  });

  it("is empty for something that is not a date", () => {
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("fullDateTime", () => {
  it("spells out the date and time", () => {
    expect(fullDateTime("2026-09-20T15:04:00.000Z")).toMatch(/September 20, 2026 at \d{1,2}:04\s?[AP]M/);
  });

  it("is empty for something that is not a date", () => {
    expect(fullDateTime("nope")).toBe("");
  });
});
