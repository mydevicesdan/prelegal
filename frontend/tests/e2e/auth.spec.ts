import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, alert, horizontalOverflow, signUp, uniqueEmail, watchConsole } from "./helpers";

const emailField = (page: Page) => page.getByLabel("Email");
const passwordField = (page: Page) => page.getByLabel("Password", { exact: true });

/** Fills in and submits the sign in form. */
async function signInThroughTheForm(page: Page, email: string, password: string) {
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("sign in page", () => {
  test("renders cleanly, with the product shown and the draft notice", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/");
    await expect(page).toHaveTitle("Prelegal");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Example of a draft agreement being filled in")).toContainText("Cloud Service Agreement");
    await expect(page.getByText("Documents made with Prelegal are drafts, not legal advice")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]); // no 401 noise: nobody being signed in is a normal answer
  });

  test("links to creating an account", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  });

  test("asks for what is missing before sending anything", async ({ page }) => {
    await page.goto("/");
    const requests: string[] = [];
    page.on("request", (r) => r.url().includes("/api/auth/login") && requests.push(r.url()));
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
    expect(requests).toEqual([]);
  });

  test("says when the email or password is wrong, and keeps what was typed", async ({ page, request }) => {
    const user = await signUp(request);
    await page.goto("/");
    await signInThroughTheForm(page, user.email, "not the password");

    await expect(alert(page)).toContainText("Incorrect email or password.");
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(emailField(page)).toHaveValue(user.email);
    await expect(passwordField(page)).toHaveValue("not the password");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("gives the same answer for an email that has no account", async ({ page }) => {
    await page.goto("/");
    await signInThroughTheForm(page, uniqueEmail("nobody"), "whatever password");
    await expect(alert(page)).toContainText("Incorrect email or password.");
  });

  test("signs in, and lands on My documents with the user's name", async ({ page, request }) => {
    const user = await signUp(request, { name: "Grace Hopper" });
    await page.goto("/");
    await signInThroughTheForm(page, user.email, user.password);

    await expect(page).toHaveURL(/\/documents\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "My documents" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Grace Hopper")).toBeVisible();
    await expect(page.getByRole("banner").getByText("GH", { exact: true })).toBeVisible();
  });

  test("submits with the Enter key", async ({ page, request }) => {
    const user = await signUp(request);
    await page.goto("/");
    await emailField(page).fill(user.email);
    await passwordField(page).fill(user.password);
    await passwordField(page).press("Enter");
    await expect(page).toHaveURL(/\/documents\/$/);
  });

  test("can show and hide the password", async ({ page }) => {
    await page.goto("/");
    await passwordField(page).fill("secret words");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(passwordField(page)).toHaveAttribute("type", "password");
  });

  test("blocks further attempts after too many wrong passwords", async ({ page, request }) => {
    const user = await signUp(request);
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await request.post("/api/auth/login", { data: { email: user.email, password: "wrong" } });
      expect(response.status()).toBe(401);
    }
    await page.goto("/");
    await signInThroughTheForm(page, user.email, user.password); // even the right password is refused for now
    await expect(alert(page)).toContainText("Too many failed attempts");
    await expect(page).toHaveURL(/localhost:3100\/$/);
  });
});

test.describe("sign up page", () => {
  test("creates an account and lands on an empty My documents", async ({ page }) => {
    await page.goto("/signup/");
    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByLabel("Work email").fill(uniqueEmail());
    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/documents\/$/);
    await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByRole("banner").getByText("AL", { exact: true })).toBeVisible();
  });

  test("explains each problem next to its field, and sends nothing", async ({ page }) => {
    await page.goto("/signup/");
    const requests: string[] = [];
    page.on("request", (r) => r.url().includes("/api/auth/signup") && requests.push(r.url()));
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter a valid email address, like name@company.com.")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    expect(requests).toEqual([]);
  });

  test("refuses a password that is too short", async ({ page }) => {
    await page.goto("/signup/");
    await page.getByLabel("Full name").fill("Ada");
    await page.getByLabel("Work email").fill(uniqueEmail());
    await passwordField(page).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(page).toHaveURL(/\/signup\/$/);
  });

  test("says when the email already has an account", async ({ page, request }) => {
    const existing = await signUp(request);
    await page.goto("/signup/");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Work email").fill(existing.email);
    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(alert(page)).toContainText("An account with this email already exists");
    await expect(page).toHaveURL(/\/signup\/$/);
  });

  test("treats emails as case-insensitive", async ({ page, request }) => {
    const existing = await signUp(request);
    await page.goto("/signup/");
    await page.getByLabel("Full name").fill("Someone Else");
    await page.getByLabel("Work email").fill(existing.email.toUpperCase());
    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(alert(page)).toContainText("already exists");
  });

  test("tells the user once that documents are drafts subject to legal review", async ({ page }) => {
    await page.goto("/signup/");
    await expect(page.getByText(/subject to legal review/)).toHaveCount(1);
    await expect(page.getByText(/subject to legal review/)).toBeVisible();
  });

  test("moves on with a single navigation: Back does not return to the form", async ({ page }) => {
    await page.goto("/signup/");
    const before = await page.evaluate(() => history.length);
    await page.getByLabel("Full name").fill("Ada Lovelace");
    await page.getByLabel("Work email").fill(uniqueEmail());
    await passwordField(page).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/documents\/$/);
    expect(await page.evaluate(() => history.length)).toBe(before); // replaced, not added to
  });

  test("links back to sign in", async ({ page }) => {
    await page.goto("/signup/");
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/localhost:3100\/$/);
  });
});

test.describe("staying signed in, and signing out", () => {
  test("the session survives a reload and a new tab", async ({ page, context }) => {
    await signUp(page);
    await page.goto("/documents/");
    await page.reload();
    await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();

    const another = await context.newPage();
    await another.goto("/documents/");
    await expect(another.getByRole("heading", { name: "My documents" })).toBeVisible();
  });

  test("someone who is already signed in is sent past the sign in and sign up pages", async ({ page }) => {
    await signUp(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/documents\/$/);
    await page.goto("/signup/");
    await expect(page).toHaveURL(/\/documents\/$/);
  });

  test("logging out returns to sign in and ends the session", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents/");
    await page.getByRole("button", { name: "Log out" }).click();

    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    expect((await page.request.get("/api/drafts")).status()).toBe(401);
    await page.goto("/documents/");
    await expect(page).toHaveURL(/localhost:3100\/$/);
  });

  test("says so, and stays signed in, when the server cannot end the session", async ({ page }) => {
    await signUp(page);
    await page.goto("/documents/");
    await page.route("**/api/auth/logout", (route) => route.abort());
    await page.getByRole("button", { name: "Log out" }).click();

    await expect(page.getByText("You are still signed in.")).toBeVisible();
    await expect(page).toHaveURL(/\/documents\/$/);
    expect((await page.request.get("/api/drafts")).status()).toBe(200); // the session really is still there

    await page.unroute("**/api/auth/logout");
    await page.getByRole("button", { name: "Log out" }).click(); // and trying again works
    await expect(page).toHaveURL(/localhost:3100\/$/);
    expect((await page.request.get("/api/drafts")).status()).toBe(401);
  });

  test("a user can sign in again after logging out", async ({ page }) => {
    const user = await signUp(page);
    await page.goto("/documents/");
    await page.getByRole("button", { name: "Log out" }).click();
    await signInThroughTheForm(page, user.email, user.password);
    await expect(page).toHaveURL(/\/documents\/$/);
  });

  test("every private page sends a signed-out visitor to sign in", async ({ page }) => {
    for (const path of ["/documents/", "/create/", "/create/?draft=1", "/create/?new=5"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/localhost:3100\/$/);
      await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    }
  });

  test("a session that has ended sends the user to sign in when they come back", async ({ page, context }) => {
    await signUp(page);
    await page.goto("/documents/");
    await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();
    await context.clearCookies(); // as if the session had expired, or the server had restarted
    await page.reload();
    await expect(page).toHaveURL(/localhost:3100\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("two users at once do not see each other", async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const a = await first.newPage();
    const b = await second.newPage();
    await signUp(a, { name: "Ada Lovelace" });
    await signUp(b, { name: "Grace Hopper" });
    await a.goto("/documents/");
    await b.goto("/documents/");
    await expect(a.getByRole("banner").getByText("Ada Lovelace")).toBeVisible();
    await expect(b.getByRole("banner").getByText("Grace Hopper")).toBeVisible();
    await a.getByRole("button", { name: "Log out" }).click();
    await b.reload();
    await expect(b.getByRole("heading", { name: "My documents" })).toBeVisible(); // logging one out leaves the other
    await first.close();
    await second.close();
  });
});

test.describe("layout and accessibility", () => {
  const scan = async (page: Page) =>
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2).join(" | ")}`,
    );

  test("sign in has no violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1600); // the highlighter animation has finished
    expect(await scan(page)).toEqual([]);
  });

  test("sign in with errors has no violations", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("sign in with a server error has no violations", async ({ page }) => {
    await page.goto("/");
    await signInThroughTheForm(page, uniqueEmail("nobody"), "whatever password");
    await expect(alert(page)).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("sign up has no violations, with and without errors", async ({ page }) => {
    await page.goto("/signup/");
    expect(await scan(page)).toEqual([]);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    expect(await scan(page)).toEqual([]);
  });

  test("the forms can be used with the keyboard alone", async ({ page, request }) => {
    const user = await signUp(request);
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(emailField(page)).toBeFocused();
    await page.keyboard.type(user.email);
    await page.keyboard.press("Tab");
    await expect(passwordField(page)).toBeFocused();
    await page.keyboard.type(user.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/documents\/$/);
  });

  test("the focused field is clearly marked", async ({ page }) => {
    await page.goto("/");
    await emailField(page).focus();
    const shadow = await emailField(page).evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
  });

  test("on a phone the brand panel gives way to the logo, and nothing scrolls sideways", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true });
    const page = await context.newPage();
    for (const path of ["/", "/signup/"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("main").getByText("Prelegal", { exact: true })).toBeVisible();
      await expect(page.getByText("Draft the agreement. Then send it to your lawyer.")).toBeHidden();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
    await context.close();
  });

  test("on a wide screen the brand panel and the form sit side by side", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    const panel = await page.getByText("Draft the agreement. Then send it to your lawyer.").boundingBox();
    const form = await page.getByRole("heading", { level: 1, name: "Sign in" }).boundingBox();
    expect(form!.x).toBeGreaterThan(panel!.x + panel!.width);
  });

  test("the highlighter animation is skipped for people who ask for reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    const animation = await page.locator(".highlight-sweep").evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
    await context.close();
  });
});
