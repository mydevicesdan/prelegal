import { readFile } from "node:fs/promises";
import path from "node:path";

// The Common Paper templates live in the repo-level /templates directory,
// which is the single source of truth. Next.js runs from /frontend.
const TEMPLATES_DIR = path.join(process.cwd(), "..", "templates");

export interface MutualNdaTemplates {
  /** Cover page title and "Using this MNDA" preamble (markdown). */
  coverIntro: string;
  /** Sentence shown directly above the signature table. */
  signingStatement: string;
  /** CC BY 4.0 attribution line that closes the cover page. */
  coverAttribution: string;
  /** Standard Terms, including the trailing attribution line (markdown). */
  standardTerms: string;
}

export async function loadMutualNdaTemplates(): Promise<MutualNdaTemplates> {
  const [cover, standardTerms] = await Promise.all([
    readFile(path.join(TEMPLATES_DIR, "Mutual-NDA-coverpage.md"), "utf8"),
    readFile(path.join(TEMPLATES_DIR, "Mutual-NDA.md"), "utf8"),
  ]);

  const coverIntro = cover.split(/^### Purpose$/m)[0]?.trim();
  const signingStatement = cover.match(/^By signing this Cover Page.*$/m)?.[0];
  const coverAttribution = cover.trim().split(/\r?\n/).at(-1);

  if (!coverIntro || !signingStatement || !coverAttribution) {
    throw new Error(
      "Mutual-NDA-coverpage.md no longer matches the structure the frontend expects.",
    );
  }

  return {
    coverIntro,
    signingStatement,
    coverAttribution,
    standardTerms: standardTerms.trim(),
  };
}
