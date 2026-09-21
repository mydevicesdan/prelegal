import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { CSA_EVERYTHING, EVERYTHING, NDA_KEY, mockChat, say } from "./chatMock";
import { PASSWORD, alert, horizontalOverflow, signUp } from "./helpers";

const chatPanel = (page: Page) => page.getByRole("region", { name: "Chat with the assistant" });
const doc = (page: Page) => page.getByRole("article");
const section = (page: Page, heading: string): Locator =>
  doc(page).getByRole("heading", { name: heading }).locator("xpath=ancestor::section[1]");
const pageTitle = (page: Page) => page.locator("header h1");
const rows = (page: Page) => page.getByRole("main").getByRole("listitem");
const saved = (page: Page) => page.getByText("Saved to My documents");

async function openCreator(page: Page) {
  await signUp(page);
  await page.goto("/create/");
  await expect(chatPanel(page)).toBeVisible();
}

/** Has the (mocked) assistant choose the CSA and fill it in, and waits for it to be saved. */
async function saveCsa(page: Page) {
  await mockChat(page, CSA_EVERYTHING);
  await say(page, "Here are all the details.", "All filled in.");
  await expect(saved(page)).toBeVisible();
}

/** The draft id the editor's address currently points at. */
const draftId = (page: Page) => Number(new URL(page.url()).searchParams.get("draft"));

test.describe("saving as you go", () => {
  test("nothing is saved until a document has been chosen", async ({ page }) => {
    await openCreator(page);
    await mockChat(page, { reply: "Sure, tell me more." });
    await say(page, "hello", "Sure, tell me more.");
    expect(await (await page.request.get("/api/drafts")).json()).toEqual([]);
    await expect(page).toHaveURL(/localhost:3100\/create\/$/);
  });

  test("saves a draft after the first turn that chooses a document, and shows it", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);

    await expect(page).toHaveURL(/\/create\/\?draft=\d+$/);
    const drafts = await (await page.request.get("/api/drafts")).json();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: draftId(page),
      documentType: "csa",
      documentName: "Cloud Service Agreement",
      companies: ["Globex LLC", "Acme Inc"],
    });
  });

  test("shows saving, then saved", async ({ page }) => {
    await openCreator(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/drafts", async (route) => {
      await gate;
      await route.continue();
    });
    await mockChat(page, { reply: "A CSA.", documentType: "csa" });
    await say(page, "a csa", "A CSA.");
    await expect(page.getByText("Saving…")).toBeVisible();
    release();
    await expect(saved(page)).toBeVisible();
  });

  test("keeps saving to the same draft as the conversation goes on", async ({ page }) => {
    await openCreator(page);
    await mockChat(page, { reply: "First.", documentType: "csa" }, { reply: "Second.", fieldValues: { "governing-law": "Ohio" } });
    await say(page, "one", "First.");
    await expect(saved(page)).toBeVisible();
    const id = draftId(page);
    await say(page, "two", "Second.");
    await expect(saved(page)).toBeVisible();

    const drafts = await (await page.request.get("/api/drafts")).json();
    expect(drafts.map((d: { id: number }) => d.id)).toEqual([id]);
    const full = await (await page.request.get(`/api/drafts/${id}`)).json();
    expect(full.state.values).toEqual({ "governing-law": "Ohio" });
    expect(full.messages.map((m: { content: string }) => m.content)).toEqual([
      expect.stringContaining("What do you need?"),
      "one",
      "First.",
      "two",
      "Second.",
    ]);
  });

  test("saves the Mutual NDA with its two companies", async ({ page }) => {
    await openCreator(page);
    await mockChat(page, { reply: "Recorded.", documentType: NDA_KEY, updates: EVERYTHING });
    await say(page, "details", "Recorded.");
    await expect(saved(page)).toBeVisible();
    const [draft] = await (await page.request.get("/api/drafts")).json();
    expect(draft).toMatchObject({ documentType: "mutual-nda", documentName: "Mutual Non-Disclosure Agreement", companies: ["Acme Corp", "Globex"] });
  });

  test("says when a save fails, keeps the document on screen, and saves on retry", async ({ page }) => {
    await openCreator(page);
    let fail = true;
    await page.route("**/api/drafts", (route) => (fail ? route.abort() : route.continue()));
    await mockChat(page, CSA_EVERYTHING);
    await say(page, "details", "All filled in.");

    await expect(page.getByText("Couldn't save this draft.")).toBeVisible();
    await expect(section(page, "Key Terms")).toContainText("Governing Law: Delaware"); // the work is still there
    expect(await (await page.request.get("/api/drafts")).json()).toEqual([]);

    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(saved(page)).toBeVisible();
    expect(await (await page.request.get("/api/drafts")).json()).toHaveLength(1);
  });

  test("a session that ends while working sends the user to sign in", async ({ page, context }) => {
    await openCreator(page);
    await context.clearCookies();
    await mockChat(page, { reply: "A CSA.", documentType: "csa" });
    await page.getByLabel("Message").fill("a csa");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
  });
});

test.describe("switching documents", () => {
  test("starts a new draft and leaves the first one as it was", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const csaId = draftId(page);

    await mockChat(page, { reply: "And an SLA.", documentType: "sla", fieldValues: { "target-uptime": "99.9%" } });
    await say(page, "we also need an SLA", "And an SLA.");
    await expect(page.getByRole("article", { name: "Service Level Agreement" })).toBeVisible();
    await expect(saved(page)).toBeVisible();
    const slaId = draftId(page);
    expect(slaId).not.toBe(csaId);

    const drafts = await (await page.request.get("/api/drafts")).json();
    expect(drafts.map((d: { documentName: string }) => d.documentName).sort()).toEqual(["Cloud Service Agreement", "Service Level Agreement"]);

    // The CSA is exactly as it was when it was left.
    const csa = await (await page.request.get(`/api/drafts/${csaId}`)).json();
    expect(csa.documentType).toBe("csa");
    expect(csa.state.values).toEqual({
      "subscription-period": "12 months from the Order Date",
      "governing-law": "Delaware",
      "chosen-courts": "The state courts in New Castle County",
    });
    expect(csa.messages.at(-1).content).toBe("All filled in.");
    // The SLA carries over what applies (the subscription period and the parties), plus what is new.
    const sla = await (await page.request.get(`/api/drafts/${slaId}`)).json();
    expect(sla.state.values["subscription-period"]).toBe("12 months from the Order Date");
    expect(sla.state.values["target-uptime"]).toBe("99.9%");
    expect(sla.companies).toEqual(["Acme Inc", "Globex LLC"]);
  });

  test("later turns go to the new draft, not the old one", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const csaId = draftId(page);
    await mockChat(page, { reply: "SLA.", documentType: "sla" }, { reply: "More SLA.", fieldValues: { "target-response-time": "4 hours" } });
    await say(page, "sla", "SLA.");
    await expect(saved(page)).toBeVisible();
    await say(page, "more", "More SLA.");
    await expect(saved(page)).toBeVisible();

    const csa = await (await page.request.get(`/api/drafts/${csaId}`)).json();
    expect(csa.state.values["target-response-time"]).toBeUndefined();
    const sla = await (await page.request.get(`/api/drafts/${draftId(page)}`)).json();
    expect(sla.state.values["target-response-time"]).toBe("4 hours");
  });
});

test.describe("My documents", () => {
  test("is empty for a new user, and invites them to start", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents/");
    await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
    await page.getByRole("link", { name: "Start a document" }).click();
    await expect(page).toHaveURL(/\/create\/$/);
  });

  test("lists what was saved, newest first, with the parties and how recent it is", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    await mockChat(page, { reply: "SLA.", documentType: "sla" });
    await say(page, "sla", "SLA.");
    await expect(saved(page)).toBeVisible();

    await page.goto("/documents/");
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(0)).toContainText("Service Level Agreement");
    await expect(rows(page).nth(1)).toContainText("Cloud Service Agreement");
    await expect(rows(page).nth(1)).toContainText("Globex LLC and Acme Inc");
    await expect(rows(page).nth(1)).toContainText("Draft");
    await expect(rows(page).nth(1)).toContainText(/Updated (just now|1 minute ago)/);
  });

  test("opens a saved document with its conversation and details restored", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const id = draftId(page);
    await page.goto("/documents/");
    await page.getByRole("link", { name: /^Open Cloud Service Agreement/ }).click();

    await expect(page).toHaveURL(new RegExp(`/create/\\?draft=${id}$`));
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();
    await expect(pageTitle(page)).toHaveText("Cloud Service Agreement");
    await expect(page.getByRole("log")).toContainText("Here are all the details.");
    await expect(page.getByRole("log")).toContainText("All filled in.");
    // The whole conversation is back, greeting included, and only once.
    await expect(page.getByRole("log").getByText(/What do you need\?/)).toHaveCount(1);
    await expect(section(page, "Key Terms")).toContainText("Governing Law: Delaware");
    await expect(section(page, "Parties")).toContainText("Provider: Acme Inc");
    await expect(page.getByText("3 of 11 details filled in")).toBeVisible();
    await expect(saved(page)).toBeVisible();
  });

  test("opens from the document's name too", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    await page.goto("/documents/");
    await page.getByRole("link", { name: "Cloud Service Agreement", exact: true }).click();
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();
  });

  test("lets the user carry on where they left off, saving to the same document", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const id = draftId(page);
    await page.goto("/documents/");
    await page.getByRole("link", { name: /^Open Cloud Service Agreement/ }).click();
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();

    await mockChat(page, { reply: "Recorded the cap.", documentType: "csa", fieldValues: { "general-cap-amount": "12 months of fees" } });
    await say(page, "the liability cap is 12 months of fees", "Recorded the cap.");
    await expect(saved(page)).toBeVisible();

    await expect(page).toHaveURL(new RegExp(`/create/\\?draft=${id}$`));
    await expect(section(page, "Key Terms")).toContainText("General Cap Amount: 12 months of fees");
    const full = await (await page.request.get(`/api/drafts/${id}`)).json();
    expect(full.state.values["general-cap-amount"]).toBe("12 months of fees");
    expect(full.state.values["governing-law"]).toBe("Delaware"); // what was there before is kept
    expect((await (await page.request.get("/api/drafts")).json())).toHaveLength(1);
  });

  test("a reload of an open document brings it straight back", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    await page.reload();
    await expect(page.getByRole("article", { name: "Cloud Service Agreement" })).toBeVisible();
    await expect(page.getByRole("log")).toContainText("All filled in.");
  });

  test("the saved documents survive signing out and back in", async ({ page }) => {
    const user = await signUp(page);
    await page.goto("/create/");
    await saveCsa(page);
    await page.goto("/documents/");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/documents\/$/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Cloud Service Agreement");
  });

  test("New document starts a fresh conversation, even from inside the editor", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    await page.getByRole("link", { name: "New document" }).first().click();

    await expect(page).toHaveURL(/\/create\/\?new=\d+$/);
    await expect(pageTitle(page)).toHaveText("New document");
    await expect(page.getByRole("log")).toContainText("What do you need?");
    await expect(page.getByRole("log")).not.toContainText("All filled in.");
    await expect(page.getByText("Your document will appear here")).toBeVisible();
    expect(await (await page.request.get("/api/drafts")).json()).toHaveLength(1); // the earlier one is untouched
  });

  test("Back from a fresh document returns to the saved one, restored, not to an empty editor", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const id = draftId(page);
    await page.getByRole("link", { name: "New document" }).first().click();
    await expect(page).toHaveURL(/\/create\/\?new=\d+$/);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/create/\\?draft=${id}$`));
    await expect(pageTitle(page)).toHaveText("Cloud Service Agreement");
    await expect(page.getByRole("log")).toContainText("All filled in.");
    // Nothing new was made by coming back.
    expect(await (await page.request.get("/api/drafts")).json()).toHaveLength(1);
  });

  test("leaving while the first save is in flight does not move the address of the page they went to", async ({ page }) => {
    await openCreator(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/drafts", async (route) => {
      if (route.request().method() === "POST") await gate; // only the save, not the list
      await route.continue();
    });
    await mockChat(page, { reply: "A CSA.", documentType: "csa" });
    await say(page, "a csa", "A CSA.");
    await expect(page.getByText("Saving…")).toBeVisible();

    await page.getByRole("link", { name: "My documents" }).first().click();
    await expect(page).toHaveURL(/\/documents\/$/);
    release();
    // The draft is still saved...
    await expect.poll(async () => (await (await page.request.get("/api/drafts")).json()).length).toBe(1);
    // ...but the address of the page they went to is not rewritten to the editor's.
    await expect(page).toHaveURL(/\/documents\/$/);
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
  });

  test("New document from the list opens an empty editor", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    await page.goto("/documents/");
    await page.getByRole("main").getByRole("link", { name: "New document" }).click();
    await expect(pageTitle(page)).toHaveText("New document");
  });

  test("a document is deleted only after confirming, and stays if the user keeps it", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const id = draftId(page);
    await page.goto("/documents/");

    await page.getByRole("button", { name: /^Delete Cloud Service Agreement/ }).click();
    await expect(page.getByText("Delete this document?")).toBeVisible();
    await page.getByRole("button", { name: "Keep" }).click();
    await expect(rows(page)).toHaveCount(1);
    expect((await page.request.get(`/api/drafts/${id}`)).status()).toBe(200);

    await page.getByRole("button", { name: /^Delete Cloud Service Agreement/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
    expect((await page.request.get(`/api/drafts/${id}`)).status()).toBe(404);
  });

  test("a deleted document's address says it is gone", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    const id = draftId(page);
    await page.request.delete(`/api/drafts/${id}`);
    await page.goto(`/create/?draft=${id}`);
    await expect(page.getByRole("heading", { name: "Document not found" })).toBeVisible();
    await page.getByRole("link", { name: "Go to My documents" }).click();
    await expect(page).toHaveURL(/\/documents\/$/);
  });

  test("an address that is not a document says so, without an error", async ({ page }) => {
    await signUp(page);
    for (const draft of ["999999", "abc", "-1"]) {
      await page.goto(`/create/?draft=${draft}`);
      await expect(page.getByRole("heading", { name: "Document not found" })).toBeVisible();
    }
  });

  test("says so, and offers to try again, when the list cannot be loaded", async ({ page }) => {
    await signUp(page);
    let fail = true;
    await page.route("**/api/drafts", (route) => (fail ? route.abort() : route.continue()));
    await page.goto("/documents/");
    await expect(alert(page)).toContainText("Could not reach the server");
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
  });
});

test.describe("one user cannot reach another's documents", () => {
  test("their list, their addresses and the API all treat them as not there", async ({ browser }) => {
    const owner = await browser.newContext();
    const other = await browser.newContext();
    const ownerPage = await owner.newPage();
    const otherPage = await other.newPage();
    await openCreator(ownerPage);
    await saveCsa(ownerPage);
    const id = draftId(ownerPage);

    await signUp(otherPage, { name: "Grace Hopper" });
    await otherPage.goto("/documents/");
    await expect(otherPage.getByRole("heading", { name: "No documents yet" })).toBeVisible();

    await otherPage.goto(`/create/?draft=${id}`);
    await expect(otherPage.getByRole("heading", { name: "Document not found" })).toBeVisible();
    await expect(otherPage.getByText("Acme Inc")).toHaveCount(0);

    expect((await otherPage.request.get(`/api/drafts/${id}`)).status()).toBe(404);
    expect((await otherPage.request.put(`/api/drafts/${id}`, { data: { documentType: "csa", companies: [], state: {}, messages: [] } })).status()).toBe(404);
    expect((await otherPage.request.delete(`/api/drafts/${id}`)).status()).toBe(404);

    // The owner's document is untouched by all of that.
    expect((await ownerPage.request.get(`/api/drafts/${id}`)).status()).toBe(200);
    await owner.close();
    await other.close();
  });
});

test.describe("accessibility and layout", () => {
  const scan = async (page: Page) =>
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`,
    );

  test("the empty list has no violations", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents/");
    await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("a list of documents has no violations, including while confirming a delete", async ({ page }) => {
    await openCreator(page);
    await saveCsa(page);
    await mockChat(page, { reply: "NDA.", documentType: NDA_KEY });
    await say(page, "nda", "NDA.");
    await expect(saved(page)).toBeVisible();
    await page.goto("/documents/");
    await expect(rows(page)).toHaveCount(2);
    expect(await scan(page)).toEqual([]);
    await page.getByRole("button", { name: /^Delete/ }).first().click();
    await expect(page.getByText("Delete this document?")).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("the not found page has no violations", async ({ page }) => {
    await signUp(page);
    await page.goto("/create/?draft=999999");
    await expect(page.getByRole("heading", { name: "Document not found" })).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("the list works on a phone, without scrolling sideways", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
    const page = await context.newPage();
    await openCreator(page);
    await saveCsa(page);
    await page.goto("/documents/");
    await expect(rows(page)).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: /^Delete/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "New document" }).first()).toBeVisible();
    await context.close();
  });

  test("the header works on a phone: logo, new document and log out are all reachable", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
    const page = await context.newPage();
    await signUp(page);
    await page.goto("/documents/");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Prelegal, my documents" })).toBeVisible();
    await expect(header.getByRole("link", { name: "My documents", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "New document" })).toBeVisible();
    await expect(header.getByRole("button", { name: "Log out" })).toBeVisible();
    // Nothing wraps onto a second line: every control is a single line tall.
    for (const control of [header.getByRole("link", { name: "New document" }), header.getByRole("button", { name: "Log out" })]) {
      expect((await control.boundingBox())!.height).toBeLessThan(45);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });

  test("a keyboard user can skip the header and land on the page", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents/");
    await expect(page.getByRole("banner")).toBeVisible(); // the page has finished loading
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });
});
