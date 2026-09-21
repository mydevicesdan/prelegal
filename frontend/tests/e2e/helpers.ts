import { expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery";

let counter = 0;
/** An email nobody has used: every test gets its own user, so tests never see each other's documents. */
export const uniqueEmail = (label = "user") =>
  `${label}-${Date.now()}-${process.pid}-${counter++}-${Math.random().toString(36).slice(2, 7)}@example.com`;

export interface TestUser {
  id: number;
  name: string;
  email: string;
  password: string;
}

/**
 * Creates an account through the API. Given a page or a browser context, that browser is signed in as the new
 * user from then on; given the bare `request` fixture, the account exists but nobody is signed in.
 */
export async function signUp(
  target: Page | BrowserContext | APIRequestContext,
  overrides: Partial<TestUser> = {},
): Promise<TestUser> {
  const details = { name: "Ada Lovelace", email: uniqueEmail(), password: PASSWORD, ...overrides };
  const api = "request" in target ? target.request : target;
  const response = await api.post("/api/auth/signup", { data: details });
  expect(response.status(), await response.text()).toBe(201);
  return { ...(await response.json()), password: details.password };
}

/** Collects console errors/warnings and page errors so tests can assert a clean page. */
export function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The page's own alert, not Next.js's route announcer (which is also role="alert" and always in the page). */
export const alert = (page: Page): Locator => page.locator("main [role=alert], form [role=alert]");
