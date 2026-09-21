import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

type PrintSpy = { __prints: string[] };

const doc = (page: Page) => page.getByRole("article");
const section = (page: Page, heading: string): Locator =>
  doc(page).getByRole("heading", { name: heading }).locator("xpath=ancestor::section[1]");
const party = (page: Page, name: "Party 1" | "Party 2") => page.getByRole("group", { name });

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Starts a session (as the fake login would) and opens the NDA creator directly. */
async function openNda(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem("prelegal.session", "tester@example.com"));
  await page.goto("/nda/");
}

/** Collects console errors/warnings and page errors so tests can assert a clean page. */
function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** Replaces window.print with a spy that records document.title at call time. */
async function spyOnPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as PrintSpy;
    w.__prints = [];
    window.print = () => void w.__prints.push(document.title);
  });
}
const prints = (page: Page) => page.evaluate(() => (window as unknown as PrintSpy).__prints);

async function fillEverything(page: Page) {
  await page.getByLabel("Purpose").fill("Exploring a joint venture.");
  await page.getByLabel("Effective date").fill("2027-01-05");
  await page.getByLabel("Governing law (state)").fill("Delaware");
  await page.getByLabel("Jurisdiction (city or county and state)").fill("New Castle, DE");
  await page.getByLabel("Modifications").fill("Section 3 is deleted.");
  const p1 = party(page, "Party 1");
  await p1.getByLabel("Company").fill("Acme Corp");
  await p1.getByLabel("Signatory name").fill("Jane Doe");
  await p1.getByLabel("Title").fill("CEO");
  await p1.getByLabel("Notice address").fill("jane@acme.com");
  const p2 = party(page, "Party 2");
  await p2.getByLabel("Company").fill("Globex");
  await p2.getByLabel("Signatory name").fill("John Smith");
  await p2.getByLabel("Title").fill("CFO");
  await p2.getByLabel("Notice address").fill("1 Main St\nSpringfield");
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("page load", () => {
  test("renders cleanly with no console errors or hydration warnings", async ({ page }) => {
    const problems = watchConsole(page);
    await openNda(page);
    await expect(page).toHaveTitle("Prelegal - Mutual NDA creator");
    await expect(page.getByRole("heading", { level: 1, name: "Mutual NDA creator" })).toBeVisible();
    await expect(doc(page).getByRole("heading", { name: "Standard Terms" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("defaults the effective date to today on the client, not baked into the static HTML", async ({ page }) => {
    await openNda(page);
    await expect(page.getByLabel("Effective date")).toHaveValue(localToday());
    await expect(section(page, "Effective Date")).not.toContainText("[Effective Date]");
  });

  test("renders no agreement without JavaScript, because the page is behind the login gate", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/nda/");
    await expect(page.getByRole("article")).toHaveCount(0);
    await context.close();
  });

  test("sends no requests to third parties", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost")) external.push(r.url());
    });
    await openNda(page);
    await page.waitForLoadState("networkidle");
    expect(external).toEqual([]);
  });
});

test.describe("form -> agreement", () => {
  test("fills every field into the cover page, terms and signature table", async ({ page }) => {
    await openNda(page);
    await fillEverything(page);

    await expect(section(page, "Purpose")).toContainText("Exploring a joint venture.");
    await expect(section(page, "Effective Date")).toContainText("January 5, 2027");
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("Governing Law: Delaware");
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("Jurisdiction: courts located in New Castle, DE");
    await expect(section(page, "MNDA Modifications")).toContainText("Section 3 is deleted.");
    await expect(doc(page)).toContainText("laws of the State of Delaware, without regard");
    await expect(doc(page)).toContainText("state courts located in New Castle, DE.");

    const table = doc(page).getByRole("table");
    for (const text of ["Acme Corp", "Jane Doe", "CEO", "jane@acme.com", "Globex", "John Smith", "CFO", "Springfield"]) {
      await expect(table).toContainText(text);
    }
  });

  test("toggles term options and years, and leaves the other option unchecked", async ({ page }) => {
    await openNda(page);
    const term = page.getByRole("group", { name: "MNDA term" });
    await term.getByLabel("Number of years").fill("3");
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Expires 3 year\(s\) from Effective Date/);

    await term.getByRole("radio", { name: "Continues until terminated" }).check();
    await expect(term.getByLabel("Number of years")).toBeDisabled();
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Continues until terminated/);
    await expect(section(page, "MNDA Term")).toContainText(/☐\s*Expires 3 year\(s\)/);

    const conf = page.getByRole("group", { name: "Term of confidentiality" });
    await conf.getByRole("radio", { name: "In perpetuity" }).check();
    await expect(section(page, "Term of Confidentiality")).toContainText(/☒\s*In perpetuity\./);
    await expect(term.getByRole("radio", { name: "Continues until terminated" })).toBeChecked();
  });

  test("updates the agreement on every keystroke", async ({ page }) => {
    await openNda(page);
    await page.getByLabel("Governing law (state)").pressSequentially("Texas");
    await expect(doc(page)).toContainText("State of Texas,");
    await page.getByLabel("Governing law (state)").press("Backspace");
    await expect(doc(page)).toContainText("State of Texa,");
  });

  test("pressing Enter in a field does not submit or reload the form", async ({ page }) => {
    await openNda(page);
    await page.getByLabel("Governing law (state)").fill("Ohio");
    await page.getByLabel("Governing law (state)").press("Enter");
    await expect(page).toHaveURL(/localhost:3100\/nda\/$/);
    await expect(page.getByLabel("Governing law (state)")).toHaveValue("Ohio");
  });

  test("handles very long values without breaking the layout", async ({ page }) => {
    // Known defect (found by this test): unbroken strings overflow the page. Remove test.fail() once fixed.
    test.fail();
    await openNda(page);
    const long = "Supercalifragilistic".repeat(40);
    await party(page, "Party 1").getByLabel("Company").fill(long);
    await page.getByLabel("Governing law (state)").fill(long);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("stays responsive with a large amount of text", async ({ page }) => {
    await openNda(page);
    const start = Date.now();
    await page.getByLabel("Modifications").fill("word ".repeat(2000));
    await expect(section(page, "MNDA Modifications")).toContainText("word word");
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test.describe("hostile input", () => {
  test("never executes script or creates elements from typed markup", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await openNda(page);
    const payload = '<img src=x onerror="alert(1)"><' + 'script>alert(2)</' + "script> [x](javascript:alert(3)) **b**";
    await page.getByLabel("Governing law (state)").fill(payload);
    await page.getByLabel("Jurisdiction (city or county and state)").fill(payload);
    await page.getByLabel("Purpose").fill(payload);
    await party(page, "Party 1").getByLabel("Company").fill(payload);
    await page.getByLabel("Modifications").fill(payload);
    await page.waitForTimeout(300);

    expect(dialogs).toEqual([]);
    expect(await doc(page).locator("img, script").count()).toBe(0);
    expect(await doc(page).locator('a[href^="javascript"]').count()).toBe(0);
    await expect(section(page, "Purpose")).toContainText(payload);
  });
});

test.describe("print / download", () => {
  test("print view shows only the agreement", async ({ page }) => {
    await openNda(page);
    await fillEverything(page);
    await page.emulateMedia({ media: "print" });
    await expect(doc(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Mutual NDA creator" })).toBeHidden();
    await expect(page.getByLabel("Purpose")).toBeHidden();
    await expect(page.getByText("Choose “Save as PDF”")).toBeHidden();
    // The agreement fills the page width now that the form column is gone.
    const box = await doc(page).boundingBox();
    expect(box!.width).toBeGreaterThan(page.viewportSize()!.width * 0.7);
  });

  test("the Download button prints with a descriptive page title, then restores it", async ({ page }) => {
    await spyOnPrint(page);
    await openNda(page);
    await party(page, "Party 1").getByLabel("Company").fill("Acme Corp");
    await party(page, "Party 2").getByLabel("Company").fill("Globex");
    await page.getByRole("button", { name: "Download PDF" }).click();

    expect(await prints(page)).toEqual(["Mutual NDA - Acme Corp - Globex"]);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page).toHaveTitle("Prelegal - Mutual NDA creator");
  });

  test("produces a real multi-page PDF", async ({ page }, testInfo) => {
    await openNda(page);
    await fillEverything(page);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await testInfo.attach("mutual-nda.pdf", { body: pdf, contentType: "application/pdf" });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(3); // cover page + at least two pages of standard terms
    expect(pages).toBeLessThanOrEqual(8);
  });
});

test.describe("responsive layout", () => {
  test("phone width: single column, no horizontal scroll, form above the agreement", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await context.newPage();
    await openNda(page);
    await fillEverything(page);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const formBox = await page.getByLabel("Purpose").boundingBox();
    const docBox = await doc(page).boundingBox();
    expect(docBox!.y).toBeGreaterThan(formBox!.y);
    expect(docBox!.x).toBeLessThan(40);
    await context.close();
  });

  test("desktop width: form and agreement sit side by side", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openNda(page);
    const formBox = await page.getByLabel("Purpose").boundingBox();
    const docBox = await doc(page).boundingBox();
    expect(docBox!.x).toBeGreaterThan(formBox!.x + formBox!.width);
  });

  test("the signature table fits on a very narrow phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    await openNda(page);
    const table = await doc(page).getByRole("table").boundingBox();
    expect(table!.x + table!.width).toBeLessThanOrEqual(320);
    await context.close();
  });
});

test.describe("keyboard", () => {
  test("the Download button works with Enter and Space", async ({ page }) => {
    await spyOnPrint(page);
    await openNda(page);
    await page.getByRole("button", { name: "Download PDF" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    expect(await prints(page)).toHaveLength(2);
  });

  test("tabbing visits the form controls in reading order", async ({ page }) => {
    await openNda(page);
    const labels: string[] = [];
    await page.getByRole("button", { name: "Download PDF" }).focus();
    for (let i = 0; i < 26; i++) {
      await page.keyboard.press("Tab");
      labels.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLInputElement;
          return (el.labels?.[0]?.textContent ?? el.getAttribute("aria-label") ?? el.tagName).trim();
        }),
      );
    }
    // The date input has month/day/year tab stops in Chrome; collapse consecutive repeats.
    const stops = labels.filter((label, i) => label !== labels[i - 1]);
    expect(stops.slice(0, 4)).toEqual(["Purpose", "Effective date", "Expires after", "Number of years"]);
    expect(labels).toContain("Governing law (state)");
    expect(labels).toContain("Modifications");
  });

  test("radio groups change with the arrow keys", async ({ page }) => {
    await openNda(page);
    const term = page.getByRole("group", { name: "MNDA term" });
    await term.getByRole("radio", { name: "Expires after" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(term.getByRole("radio", { name: "Continues until terminated" })).toBeChecked();
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Continues until terminated/);
  });
});

test.describe("accessibility (axe, WCAG 2.0/2.1 A + AA)", () => {
  const run = async (page: Page) =>
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations;
  const summarize = (violations: Awaited<ReturnType<typeof run>>) =>
    violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`);

  test("initial page has no violations", async ({ page }) => {
    // Known defect (review + axe): gray-400 placeholder text fails colour contrast. Remove test.fail() once fixed.
    test.fail();
    await openNda(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("filled-in page has no violations", async ({ page }) => {
    await openNda(page);
    await fillEverything(page);
    expect(summarize(await run(page))).toEqual([]);
  });
});

test.describe("date input (real browser)", () => {
  test("a year with more than four digits does not blank out the effective date", async ({ page }) => {
    // Known defect (review): formatDate only accepts 4-digit years. Remove test.fail() once fixed.
    test.fail();
    await openNda(page);
    const date = page.getByLabel("Effective date");
    await date.evaluate((el: HTMLInputElement) => {
      // Chrome's date field allows years up to 275760; set it the way a user typing a 5th digit would.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, "20261-09-19");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(date).toHaveValue("20261-09-19");
    await expect(section(page, "Effective Date")).not.toContainText("[Effective Date]");
  });
});
