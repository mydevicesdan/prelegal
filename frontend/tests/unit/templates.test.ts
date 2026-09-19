import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMutualNdaTemplates } from "@/lib/templates";

const TEMPLATES_DIR = path.join(process.cwd(), "..", "templates");
const read = (name: string) => readFile(path.join(TEMPLATES_DIR, name), "utf8");

describe("loadMutualNdaTemplates (real files)", () => {
  it("extracts the cover page intro without any of the fillable sections", async () => {
    const { coverIntro } = await loadMutualNdaTemplates();
    expect(coverIntro).toMatch(/^# Mutual Non-Disclosure Agreement/);
    expect(coverIntro).toContain("USING THIS MUTUAL NON-DISCLOSURE AGREEMENT");
    expect(coverIntro).toContain("commonpaper.com/standards/mutual-nda/1.0");
    expect(coverIntro).not.toContain("### Purpose");
    expect(coverIntro).not.toContain("Effective Date");
  });

  it("extracts the signing statement", async () => {
    const { signingStatement } = await loadMutualNdaTemplates();
    expect(signingStatement).toBe(
      "By signing this Cover Page, each party agrees to enter into this MNDA as of the Effective Date.",
    );
  });

  it("extracts the CC BY 4.0 attribution for the cover page", async () => {
    const { coverAttribution } = await loadMutualNdaTemplates();
    expect(coverAttribution).toContain("Common Paper Mutual Non-Disclosure Agreement");
    expect(coverAttribution).toContain("https://creativecommons.org/licenses/by/4.0/");
  });

  it("returns the standard terms in full, with attribution", async () => {
    const { standardTerms } = await loadMutualNdaTemplates();
    expect(standardTerms).toBe((await read("Mutual-NDA.md")).trim());
    expect(standardTerms).toMatch(/^# Standard Terms/);
    expect(standardTerms).toMatch(/\[CC BY 4\.0\]\(https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/\)\.$/);
  });
});

describe("loadMutualNdaTemplates (synthetic files)", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  async function loadWith(cover: string, terms: string) {
    vi.resetModules();
    const readFile = async (file: string) => (String(file).endsWith("coverpage.md") ? cover : terms);
    vi.doMock("node:fs/promises", () => ({ readFile, default: { readFile } }));
    const mod = await import("@/lib/templates");
    return mod.loadMutualNdaTemplates();
  }

  it("copes with Windows (CRLF) line endings, as git may check the templates out", async () => {
    const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");
    const templates = await loadWith(crlf(await read("Mutual-NDA-coverpage.md")), crlf(await read("Mutual-NDA.md")));
    expect(templates.coverIntro).not.toContain("### Purpose");
    expect(templates.signingStatement).toBe(
      "By signing this Cover Page, each party agrees to enter into this MNDA as of the Effective Date.",
    );
    expect(templates.coverAttribution).toContain("CC BY 4.0");
  });

  it("throws a clear error if the cover page structure changes", async () => {
    await expect(loadWith("# Title\n\nno sections here\n", "# Standard Terms")).rejects.toThrow(
      /no longer matches the structure/,
    );
  });

  it("throws if the signing statement disappears", async () => {
    const cover = (await read("Mutual-NDA-coverpage.md")).replace(/^By signing this Cover Page.*$/m, "");
    await expect(loadWith(cover, "# Standard Terms")).rejects.toThrow(/no longer matches the structure/);
  });
});
