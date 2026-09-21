import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { csaSpec } from "../fixtures";
import { CSA_EVERYTHING, EVERYTHING, NDA_KEY, mockChat, mockDocuments, say, type Updates } from "./chatMock";

type PrintSpy = { __prints: string[] };

const doc = (page: Page) => page.getByRole("article");
const section = (page: Page, heading: string): Locator =>
  doc(page).getByRole("heading", { name: heading }).locator("xpath=ancestor::section[1]");
const chatPanel = (page: Page) => page.getByRole("region", { name: "Chat with the assistant" });
const download = (page: Page) => page.getByRole("button", { name: "Download PDF" });

const todayLong = () =>
  new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Starts a session (as the fake login would) and opens the document creator directly. */
async function openCreator(page: Page): Promise<string[]> {
  const requestedDocuments = await mockDocuments(page);
  await page.addInitScript(() => sessionStorage.setItem("prelegal.session", "tester@example.com"));
  await page.goto("/documents/");
  return requestedDocuments;
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

/** Has the (mocked) assistant choose the Mutual NDA. */
async function chooseNda(page: Page) {
  await mockChat(page, { reply: "An NDA it is.", documentType: NDA_KEY });
  await say(page, "I need an NDA.", "An NDA it is.");
  await expect(doc(page)).toBeVisible();
}

/** Has the (mocked) assistant fill in the given Mutual NDA fields in one turn. */
async function fillNda(page: Page, updates: Updates) {
  await mockChat(page, { reply: "Recorded.", documentType: NDA_KEY, updates });
  await say(page, "Please record this.", "Recorded.");
}

const fillEverything = (page: Page) => fillNda(page, EVERYTHING);

/** Has the (mocked) assistant choose the Cloud Service Agreement and fill in everything. */
async function fillCsa(page: Page) {
  await mockChat(page, CSA_EVERYTHING);
  await say(page, "Here are all the details.", "All filled in.");
  await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("page load", () => {
  test("renders cleanly with no console errors or hydration warnings, and nothing chosen yet", async ({ page }) => {
    const problems = watchConsole(page);
    await openCreator(page);
    await expect(page).toHaveTitle("Prelegal - Legal document creator");
    await expect(page.getByRole("heading", { level: 1, name: "Legal document creator" })).toBeVisible();
    await expect(chatPanel(page).getByRole("log")).toContainText("What do you need?");
    await expect(page.getByText("Your document will appear here")).toBeVisible();
    await expect(doc(page)).toHaveCount(0);
    await expect(download(page)).toBeDisabled();
    expect(problems).toEqual([]);
  });

  test("defaults the Mutual NDA's effective date to today on the client, not baked into the static HTML", async ({ page }) => {
    await openCreator(page);
    await chooseNda(page);
    await expect(section(page, "Effective Date")).toContainText(todayLong());
  });

  test("renders no agreement without JavaScript, because the page is behind the login gate", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/documents/");
    await expect(page.getByRole("article")).toHaveCount(0);
    await context.close();
  });

  test("sends no requests to third parties", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost")) external.push(r.url());
    });
    await openCreator(page);
    await page.waitForLoadState("networkidle");
    expect(external).toEqual([]);
  });
});

test.describe("chat", () => {
  test("sends the conversation and the current state, and shows the reply", async ({ page }) => {
    const requests = await mockChat(page, { reply: "Thanks! Which state's law should govern?" });
    await openCreator(page);
    await say(page, "Acme and Globex", "Which state's law should govern?");

    expect(requests).toHaveLength(1);
    expect(requests[0].messages.map((m) => m.role)).toEqual(["assistant", "user"]);
    expect(requests[0].messages[1].content).toBe("Acme and Globex");
    expect(requests[0].documentType).toBeNull();
    expect(requests[0].values).toEqual([]);
    expect(requests[0].fields.governingLaw).toBeNull();
  });

  test("keeps the conversation going and tells the assistant what is already filled in", async ({ page }) => {
    const requests = await mockChat(
      page,
      { reply: "First.", documentType: NDA_KEY, updates: { governingLaw: "Ohio" } },
      { reply: "Second." },
    );
    await openCreator(page);
    await say(page, "one", "First.");
    await say(page, "two", "Second.");

    expect(requests[1].messages.map((m) => m.content).slice(-3)).toEqual(["one", "First.", "two"]);
    expect(requests[1].documentType).toBe(NDA_KEY);
    expect(requests[1].fields.governingLaw).toBe("Ohio");
  });

  test("Enter sends, Shift+Enter adds a line, and the page does not reload", async ({ page }) => {
    const requests = await mockChat(page, { reply: "Got it." });
    await openCreator(page);
    const input = page.getByLabel("Message");
    await input.fill("line one");
    await input.press("Shift+Enter");
    await input.pressSequentially("line two");
    expect(requests).toHaveLength(0);

    await input.press("Enter");
    await expect(page.getByRole("log")).toContainText("Got it.");
    expect(requests[0].messages.at(-1)?.content).toBe("line one\nline two");
    await expect(page).toHaveURL(/localhost:3100\/documents\/$/);
    await expect(input).toHaveValue("");
  });

  test("shows an error, leaves the document alone, and retries", async ({ page }) => {
    await mockChat(
      page,
      { status: 502, detail: "The AI assistant could not respond. Please try again." },
      { reply: "Back again.", documentType: NDA_KEY, updates: { governingLaw: "Ohio" } },
    );
    await openCreator(page);
    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(chatPanel(page).getByRole("alert")).toContainText("The AI assistant could not respond.");
    await expect(doc(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("log")).toContainText("Back again.");
    await expect(chatPanel(page).getByRole("alert")).toHaveCount(0);
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("Governing Law: Ohio");
  });

  test("reports an unreachable server", async ({ page }) => {
    await page.route("**/api/chat", (route) => route.abort());
    await openCreator(page);
    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(chatPanel(page).getByRole("alert")).toContainText("Could not reach the server");
  });

  test("an unsupported request gets an explanation and no document", async ({ page }) => {
    const reply = "I can't draft an employment agreement. The closest I can do is a Mutual NDA.";
    await mockChat(page, { reply });
    await openCreator(page);
    await say(page, "Draft an employment agreement for a new hire", reply);

    await expect(doc(page)).toHaveCount(0);
    await expect(page.getByText("Your document will appear here")).toBeVisible();
    await expect(download(page)).toBeDisabled();
  });
});

test.describe("Mutual NDA", () => {
  test("fills every field into the cover page, terms and signature table", async ({ page }) => {
    await openCreator(page);
    await fillEverything(page);

    await expect(page.getByText("Drafting: Mutual Non-Disclosure Agreement")).toBeVisible();
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
    await openCreator(page);
    await fillNda(page, { termType: "expires", termYears: 3, confidentialityType: "perpetuity" });
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Expires 3 year\(s\) from Effective Date/);
    await expect(section(page, "MNDA Term")).toContainText(/☐\s*Continues until terminated/);
    await expect(section(page, "Term of Confidentiality")).toContainText(/☒\s*In perpetuity\./);

    await fillNda(page, { termType: "continues" });
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Continues until terminated/);
    await expect(section(page, "MNDA Term")).toContainText(/☐\s*Expires 3 year\(s\)/);
    await expect(section(page, "Term of Confidentiality")).toContainText(/☒\s*In perpetuity\./);
  });

  test("ignores updates that make no sense", async ({ page }) => {
    await openCreator(page);
    await fillNda(page, { effectiveDate: "next Friday", termYears: 0 });
    await expect(section(page, "Effective Date")).toContainText(todayLong());
    await expect(section(page, "MNDA Term")).toContainText(/☒\s*Expires 1 year\(s\)/);
  });

  test("handles very long values without breaking the layout", async ({ page }) => {
    // Known defect (found by this test): unbroken strings overflow the page. Remove test.fail() once fixed.
    test.fail();
    await openCreator(page);
    const long = "Supercalifragilistic".repeat(40);
    await fillNda(page, { governingLaw: long, party1: { company: long } });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("stays responsive with a large amount of text", async ({ page }) => {
    await openCreator(page);
    const start = Date.now();
    await fillNda(page, { modifications: "word ".repeat(2000) });
    await expect(section(page, "MNDA Modifications")).toContainText("word word");
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test.describe("other documents", () => {
  test("shows the generated front page of the chosen document, loading its spec once", async ({ page }) => {
    const requested = await openCreator(page);
    await mockChat(page, { reply: "A CSA. Who are the parties?", documentType: "csa" }, { reply: "Thanks." });
    await say(page, "a SaaS agreement", "A CSA. Who are the parties?");

    const article = page.getByRole("article", { name: "Cloud Service Agreement" });
    await expect(article).toBeVisible();
    await expect(page.getByText("Drafting: Cloud Service Agreement · 0 of 3 details filled in")).toBeVisible();
    await expect(section(page, "Parties")).toContainText("Provider: [Provider company]");
    await expect(section(page, "Order Form")).toContainText("Subscription Period: [Subscription Period]");
    await expect(section(page, "Key Terms")).toContainText("Governing Law: [Governing Law]");
    await expect(download(page)).toBeEnabled();

    await say(page, "more", "Thanks.");
    expect(requested).toEqual(["csa"]);
  });

  test("fills in the values, the parties and the signature table as the assistant learns them", async ({ page }) => {
    await openCreator(page);
    await fillCsa(page);

    await expect(page.getByText("Drafting: Cloud Service Agreement · 3 of 3 details filled in")).toBeVisible();
    await expect(section(page, "Parties")).toContainText("Provider: Acme Inc");
    await expect(section(page, "Parties")).toContainText("Customer: Globex LLC");
    await expect(section(page, "Order Form")).toContainText("Subscription Period: 12 months from the Order Date");
    await expect(section(page, "Key Terms")).toContainText("Governing Law: Delaware");
    await expect(section(page, "Key Terms")).toContainText("Chosen Courts: The state courts in New Castle County");

    const table = doc(page).getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["", "CUSTOMER", "PROVIDER"]);
    for (const text of ["Acme Inc", "Jane Doe", "CEO", "jane@acme.com", "Globex LLC", "John Smith", "CFO", "Springfield"]) {
      await expect(table).toContainText(text);
    }
  });

  test("shows the standard terms with defined terms in bold and nested clause numbering", async ({ page }) => {
    await openCreator(page);
    await fillCsa(page);

    const terms = doc(page).getByRole("heading", { name: "Standard Terms" }).locator("xpath=ancestor::section[1]");
    await expect(terms.locator("strong", { hasText: /^Governing Law$/ })).toBeVisible();
    // The numbers ("1.", "1.1.", "2.1." ...) are CSS-generated content, which the DOM does not expose, so
    // check that the rules producing them are in effect.
    const styles = await terms.locator("ol, li").evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return el.tagName === "OL"
          ? style.listStyleType
          : `${style.counterIncrement}|${getComputedStyle(el, "::before").content}`;
      }),
    );
    expect(styles.filter((s) => s === "none")).toHaveLength(3); // the top-level list and one per clause
    expect(styles.filter((s) => s.startsWith("clause 1|") && s.includes("counters(clause"))).toHaveLength(5);
    await expect(doc(page).getByRole("link", { name: "CC BY 4.0" })).toBeVisible();
  });

  test("switching to another document keeps the parties and the values that carry over", async ({ page }) => {
    const requested = await openCreator(page);
    await fillCsa(page);
    await mockChat(page, { reply: "And an SLA.", documentType: "sla", fieldValues: { "target-uptime": "99.9%" } });
    await say(page, "we also need an SLA", "And an SLA.");

    const article = page.getByRole("article", { name: "Service Level Agreement" });
    await expect(article).toBeVisible();
    await expect(section(page, "Parties")).toContainText("Provider: Acme Inc");
    await expect(section(page, "Order Form")).toContainText("Subscription Period: 12 months from the Order Date");
    await expect(section(page, "Order Form")).toContainText("Target Uptime: 99.9%");
    await expect(page.getByText("Drafting: Service Level Agreement · 2 of 2 details filled in")).toBeVisible();
    expect(requested).toEqual(["csa", "sla"]);
  });

  test("moving from a generic document to the NDA and back shows each with its own details", async ({ page }) => {
    await openCreator(page);
    await fillCsa(page);
    await fillNda(page, { governingLaw: "Ohio" });
    await expect(section(page, "Governing Law & Jurisdiction")).toContainText("Governing Law: Ohio");
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toHaveCount(0);

    await mockChat(page, { reply: "Back to the CSA.", documentType: "csa" });
    await say(page, "back to the csa", "Back to the CSA.");
    await expect(section(page, "Key Terms")).toContainText("Governing Law: Delaware");
    await expect(doc(page)).not.toContainText("Ohio");
  });

  test("says when the document cannot be loaded and loads it on retry", async ({ page }) => {
    let failNext = true;
    await page.route("**/api/documents/*", (route) => {
      if (failNext) {
        failNext = false;
        return route.abort();
      }
      return route.fulfill({ json: csaSpec });
    });
    await page.addInitScript(() => sessionStorage.setItem("prelegal.session", "tester@example.com"));
    await page.goto("/documents/");
    await mockChat(page, { reply: "A CSA.", documentType: "csa" });
    await say(page, "a csa", "A CSA.");

    await expect(page.getByText("Could not reach the server")).toBeVisible();
    await expect(download(page)).toBeDisabled();
    await page.getByRole("button", { name: "Try loading it again" }).click();
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();
    await expect(download(page)).toBeEnabled();
  });

  test("never executes script or creates elements from markup in values", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const payload = '<img src=x onerror="alert(1)"><' + 'script>alert(2)</' + "script> [x](javascript:alert(3)) **b**";
    await openCreator(page);
    await mockChat(page, {
      reply: "Recorded.",
      documentType: "csa",
      fieldValues: { "governing-law": payload, "chosen-courts": payload },
      parties: { Provider: { company: payload, name: payload } },
    });
    await say(page, "go", "Recorded.");
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();
    await page.waitForTimeout(300);

    expect(dialogs).toEqual([]);
    expect(await doc(page).locator("img, script").count()).toBe(0);
    expect(await doc(page).locator('a[href^="javascript"]').count()).toBe(0);
    await expect(section(page, "Key Terms")).toContainText(payload);
  });
});

test.describe("hostile input", () => {
  test("never executes script or creates elements from markup in the Mutual NDA's fields or replies", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const payload = '<img src=x onerror="alert(1)"><' + 'script>alert(2)</' + "script> [x](javascript:alert(3)) **b**";
    await mockChat(page, {
      reply: payload,
      documentType: NDA_KEY,
      updates: {
        governingLaw: payload,
        jurisdiction: payload,
        purpose: payload,
        modifications: payload,
        party1: { company: payload },
      },
    });
    await openCreator(page);
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
    await openCreator(page);
    await fillEverything(page);
    await page.emulateMedia({ media: "print" });
    await expect(doc(page)).toBeVisible();
    await expect(download(page)).toBeHidden();
    await expect(page.getByRole("heading", { name: "Legal document creator" })).toBeHidden();
    await expect(page.getByText("Drafting:")).toBeHidden();
    await expect(chatPanel(page)).toBeHidden();
    await expect(page.getByText("Choose “Save as PDF”")).toBeHidden();
    // The agreement fills the page width now that the chat column is gone.
    const box = await doc(page).boundingBox();
    expect(box!.width).toBeGreaterThan(page.viewportSize()!.width * 0.7);
  });

  test("print view of another document shows only the agreement too", async ({ page }) => {
    await openCreator(page);
    await fillCsa(page);
    await page.emulateMedia({ media: "print" });
    await expect(doc(page)).toBeVisible();
    await expect(chatPanel(page)).toBeHidden();
    await expect(download(page)).toBeHidden();
    const box = await doc(page).boundingBox();
    expect(box!.width).toBeGreaterThan(page.viewportSize()!.width * 0.7);
  });

  test("the Download button prints with a descriptive page title, then restores it", async ({ page }) => {
    await spyOnPrint(page);
    await openCreator(page);
    await fillNda(page, { party1: { company: "Acme Corp" }, party2: { company: "Globex" } });
    await download(page).click();

    expect(await prints(page)).toEqual(["Mutual NDA - Acme Corp - Globex"]);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page).toHaveTitle("Prelegal - Legal document creator");
  });

  test("another document's PDF is named after the document and its parties", async ({ page }) => {
    await spyOnPrint(page);
    await openCreator(page);
    await fillCsa(page);
    await download(page).click();
    expect(await prints(page)).toEqual(["Cloud Service Agreement - Globex LLC - Acme Inc"]);
  });

  test("produces a real multi-page PDF of the Mutual NDA", async ({ page }, testInfo) => {
    await openCreator(page);
    await fillEverything(page);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await testInfo.attach("mutual-nda.pdf", { body: pdf, contentType: "application/pdf" });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(3); // cover page + at least two pages of standard terms
    expect(pages).toBeLessThanOrEqual(8);
  });

  test("produces a PDF of another document with the terms starting on a new page", async ({ page }, testInfo) => {
    await openCreator(page);
    await fillCsa(page);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    await testInfo.attach("cloud-service-agreement.pdf", { body: pdf, contentType: "application/pdf" });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;
    expect(pages).toBe(2); // the front page, then the standard terms
  });
});

test.describe("responsive layout", () => {
  test("phone width: single column, no horizontal scroll, chat above the agreement", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await context.newPage();
    await openCreator(page);
    await fillEverything(page);

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const chatBox = await chatPanel(page).boundingBox();
    const docBox = await doc(page).boundingBox();
    expect(docBox!.y).toBeGreaterThan(chatBox!.y);
    expect(docBox!.x).toBeLessThan(40);
    await context.close();
  });

  test("phone width: another document also has no horizontal scroll", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    await openCreator(page);
    await fillCsa(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("desktop width: chat and agreement sit side by side", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await openCreator(page);
    await chooseNda(page);
    const chatBox = await chatPanel(page).boundingBox();
    const docBox = await doc(page).boundingBox();
    expect(docBox!.x).toBeGreaterThan(chatBox!.x + chatBox!.width);
  });

  test("the signature table fits on a very narrow phone", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    await openCreator(page);
    await chooseNda(page);
    const table = await doc(page).getByRole("table").boundingBox();
    expect(table!.x + table!.width).toBeLessThanOrEqual(320);
    await context.close();
  });
});

test.describe("keyboard", () => {
  test("the Download button works with Enter and Space", async ({ page }) => {
    await spyOnPrint(page);
    await openCreator(page);
    await chooseNda(page);
    await download(page).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    expect(await prints(page)).toHaveLength(2);
  });

  test("the chat can be used entirely from the keyboard", async ({ page }) => {
    await mockChat(page, { reply: "Keyboard reply.", documentType: NDA_KEY, updates: { governingLaw: "Ohio" } });
    await openCreator(page);
    await page.getByLabel("Message").focus();
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
    await openCreator(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("a document with unfilled placeholders has no violations", async ({ page }) => {
    // Known defect (review + axe): the gray-400 placeholder text in the agreement fails colour contrast. Remove test.fail() once fixed.
    test.fail();
    await openCreator(page);
    await chooseNda(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("filled-in Mutual NDA has no violations", async ({ page }) => {
    await openCreator(page);
    await fillEverything(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("filled-in generic document has no violations", async ({ page }) => {
    await openCreator(page);
    await fillCsa(page);
    expect(summarize(await run(page))).toEqual([]);
  });

  test("chat showing an error has no violations", async ({ page }) => {
    await mockChat(page, { status: 503, detail: "The AI assistant is not configured." });
    await openCreator(page);
    await page.getByLabel("Message").fill("hello");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(chatPanel(page).getByRole("alert")).toBeVisible();
    // Scoped to the chat: the agreement's placeholder contrast is the known defect above.
    expect(summarize(await run(page, '[aria-label="Chat with the assistant"]'))).toEqual([]);
  });
});
