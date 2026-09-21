import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { EVERYTHING, mockChat, say, type Updates } from "./chatMock";

type PrintSpy = { __prints: string[] };

const doc = (page: Page) => page.getByRole("article");
const section = (page: Page, heading: string): Locator =>
  doc(page).getByRole("heading", { name: heading }).locator("xpath=ancestor::section[1]");
const chatPanel = (page: Page) => page.getByRole("region", { name: "Chat with the assistant" });

const todayLong = () =>
  new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

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

/** Has the (mocked) assistant fill in every field in one turn. */
async function fillEverything(page: Page) {
  await mockChat(page, { reply: "All filled in.", updates: EVERYTHING });
  await say(page, "Here are all the details.", "All filled in.");
}

/** Has the (mocked) assistant fill in the given fields in one turn. */
async function fill(page: Page, updates: Updates) {
  await mockChat(page, { reply: "Recorded.", updates });
  await say(page, "Please record this.", "Recorded.");
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
    await expect(chatPanel(page).getByRole("log")).toContainText("Who are the two parties");
    expect(problems).toEqual([]);
  });

  test("defaults the effective date to today on the client, not baked into the static HTML", async ({ page }) => {
    await openNda(page);
    await expect(section(page, "Effective Date")).toContainText(todayLong());
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

test.describe("chat", () => {
  test("sends the conversation and the current document, and shows the reply", async ({ page }) => {
    const requests = await mockChat(page, { reply: "Thanks! Which state's law should govern?" });
    await openNda(page);
    await say(page, "Acme and Globex", "Which state's law should govern?");

    expect(requests).toHaveLength(1);
    expect(requests[0].messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(requests[0].messages[1].content).toBe("Acme and Globex");
    expect(requests[0].fields.termType).toBe("expires");
    expect(requests[0].fields.governingLaw).toBeNull();
  });

  test("keeps the conversation going and tells the assistant what is already filled in", async ({ page }) => {
    const requests = await mockChat(
      page,
      { reply: "First.", updates: { governingLaw: "Ohio" } },
      { reply: "Second." },
    );
    await openNda(page);
    await say(page, "one", "First.");
    await say(page, "two", "Second.");

    expect(requests[1].messages.map((m) => m.content).slice(-3)).toEqual(["one", "First.", "two"]);
    expect(requests[1].fields.governingLaw).toBe("Ohio");
  });

  test("Enter sends, Shift+Enter adds a line, and the page does not reload", async ({ page }) => {
    const requests = await mockChat(page, { reply: "Got it." });
    await openNda(page);
    const input = page.getByLabel("Message");
    await input.fill("line one");
    await input.press("Shift+Enter");
    await input.pressSequentially("line two");
    expect(requests).toHaveLength(0);

    await input.press("Enter");
    await expect(page.getByRole("log")).toContainText("Got it.");
    expect(requests[0].messages.at(-1)?.content).toBe("line one\nline two");
    await expect(page).toHaveURL(/localhost:3100\/nda\/$/);
    await expect(input).toHaveValue("");
  });

  test("shows an error, leaves the document alone, and retries", async ({ page }) => {
    await mockChat(
      page,
      { status: 502, detail: "The AI assistant could not respond. Please try again." },
      { reply: "Back again.", updates: { governingLaw: "Ohio" } },
    );
    await openNda(page);
    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(chatPanel(page).getByRole("alert")).toContainText("The AI assistant could not respond.");
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("[Fill in state]");

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("log")).toContainText("Back again.");
    await expect(chatPanel(page).getByRole("alert")).toHaveCount(0);
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("Governing Law: Ohio");
  });

  test("reports an unreachable server", async ({ page }) => {
    await page.route("**/api/chat", (route) => route.abort());
    await openNda(page);
    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(chatPanel(page).getByRole("alert")).toContainText("Could not reach the server");
  });
});

test.describe("chat -> agreement", () => {
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

  test("applies term and confidentiality choices and leaves the other option unchecked", async ({ page }) => {
    await openNda(page);
    await fill(page, { termType: "expires", termYears: 3, confidentialityType: "perpetuity" });
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Expires 3 year\(s\) from Effective Date/);
    await expect(section(page, "MNDA Term")).toContainText(/☐\s*Continues until terminated/);
    await expect(section(page, "Term of Confidentiality")).toContainText(/☒\s*In perpetuity\./);

    await fill(page, { termType: "continues" });
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Continues until terminated/);
    await expect(section(page, "MNDA Term")).toContainText(/☐\s*Expires 3 year\(s\)/);
    await expect(section(page, "Term of Confidentiality")).toContainText(/☒\s*In perpetuity\./);
  });

  test("ignores updates that make no sense", async ({ page }) => {
    await openNda(page);
    await fill(page, { effectiveDate: "next Friday", termYears: 0 });
    await expect(section(page, "Effective Date")).toContainText(todayLong());
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Expires 1 year\(s\)/);
  });

  test("handles very long values without breaking the layout", async ({ page }) => {
    // Known defect (found by this test): unbroken strings overflow the page. Remove test.fail() once fixed.
    test.fail();
    await openNda(page);
    const long = "Supercalifragilistic".repeat(40);
    await fill(page, { governingLaw: long, party1: { company: long } });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("stays responsive with a large amount of text", async ({ page }) => {
    await openNda(page);
    const start = Date.now();
    await fill(page, { modifications: "word ".repeat(2000) });
    await expect(section(page, "MNDA Modifications")).toContainText("word word");
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test.describe("hostile input", () => {
  test("never executes script or creates elements from markup in fields or replies", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const payload = '<img src=x onerror="alert(1)"><' + 'script>alert(2)</' + "script> [x](javascript:alert(3)) **b**";
    await mockChat(page, {
      reply: payload,
      updates: {
        governingLaw: payload,
        jurisdiction: payload,
        purpose: payload,
        modifications: payload,
        party1: { company: payload },
      },
    });
    await openNda(page);
    await say(page, "go", "[x](javascript:alert(3))");
    await page.waitForTimeout(300);

    expect(dialogs).toEqual([]);
    expect(await page.locator("main img, main script").count()).toBe(0);
    expect(await page.locator('main a[href^="javascript"]').count()).toBe(0);
    expect(await page.getByRole("log").locator("strong, img").count()).toBe(0);
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
    await expect(chatPanel(page)).toBeHidden();
    await expect(page.getByText("Choose “Save as PDF”")).toBeHidden();
    // The agreement fills the page width now that the chat column is gone.
    const box = await doc(page).boundingBox();
    expect(box!.width).toBeGreaterThan(page.viewportSize()!.width * 0.7);
  });

  test("the Download button prints with a descriptive page title, then restores it", async ({ page }) => {
    await spyOnPrint(page);
    await openNda(page);
    await fill(page, { party1: { company: "Acme Corp" }, party2: { company: "Globex" } });
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
  test("phone width: single column, no horizontal scroll, chat above the agreement", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await context.newPage();
    await openNda(page);
    await fillEverything(page);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const chatBox = await chatPanel(page).boundingBox();
    const docBox = await doc(page).boundingBox();
    expect(docBox!.y).toBeGreaterThan(chatBox!.y);
    expect(docBox!.x).toBeLessThan(40);
    await context.close();
  });

  test("desktop width: chat and agreement sit side by side", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openNda(page);
    const chatBox = await chatPanel(page).boundingBox();
    const docBox = await doc(page).boundingBox();
    expect(docBox!.x).toBeGreaterThan(chatBox!.x + chatBox!.width);
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

  test("the chat can be used entirely from the keyboard", async ({ page }) => {
    await mockChat(page, { reply: "Keyboard reply.", updates: { governingLaw: "Ohio" } });
    await openNda(page);
    await page.getByRole("button", { name: "Download PDF" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Message")).toBeFocused();
    await page.keyboard.type("hello");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Send" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("log")).toContainText("Keyboard reply.");
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("Governing Law: Ohio");
  });
});

test.describe("accessibility (axe, WCAG 2.0/2.1 A + AA)", () => {
  const run = async (page: Page, scope?: string) => {
    const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
    return (await (scope ? axe.include(scope) : axe).analyze()).violations;
  };
  const summarize = (violations: Awaited<ReturnType<typeof run>>) =>
    violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`);

  test("initial page has no violations", async ({ page }) => {
    // Known defect (review + axe): the gray-400 placeholder text in the agreement fails colour contrast. Remove test.fail() once fixed.
    test.fail();
    await openNda(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("filled-in page has no violations", async ({ page }) => {
    await openNda(page);
    await fillEverything(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("chat showing an error has no violations", async ({ page }) => {
    await mockChat(page, { status: 503, detail: "The AI assistant is not configured." });
    await openNda(page);
    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(chatPanel(page).getByRole("alert")).toBeVisible();
    // Scoped to the chat: the agreement's placeholder contrast is the known defect above.
    expect(summarize(await run(page, '[aria-label="Chat with the assistant"]'))).toEqual([]);
  });
});
