import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Opens the login page and waits for hydration, so a click can't fall through to a native form submit. */
async function openLogin(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

test.describe("fake login", () => {
  test("any details sign the user in to the document creator", async ({ page }) => {
    await openLogin(page);
    await page.getByLabel("Email").fill("someone@example.com");
    await page.getByLabel("Password").fill("whatever");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/documents\/$/);
    await expect(page.getByRole("heading", { name: "Legal document creator" })).toBeVisible();
    await expect(page.getByText("someone@example.com")).toBeVisible();
  });

  test("empty details are also accepted", async ({ page }) => {
    await openLogin(page);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/documents\/$/);
    await expect(page.getByRole("heading", { name: "Legal document creator" })).toBeVisible();
  });

  test("log out returns to the login screen and locks the documents page", async ({ page }) => {
    await openLogin(page);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/documents/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("visiting the documents page without a session redirects to login", async ({ page }) => {
    await page.goto("/documents/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Prelegal" })).toBeVisible();
  });

  test("login page has no accessibility violations or console errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(m.text());
    });
    await openLogin(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    expect(problems).toEqual([]);
  });
});
