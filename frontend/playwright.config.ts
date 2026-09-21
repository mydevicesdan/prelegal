import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// The tests run against the real backend (sign-up, sessions, saved documents), which serves the built static
// export, exactly as in production. Only the AI call is replaced, inside the browser, by the tests themselves.
// Set E2E_UV if uv is not on your PATH, e.g. E2E_UV="python -m uv".
const UV = process.env.E2E_UV ?? "uv";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npm run build && ${UV} run --project ../backend uvicorn --app-dir ../backend app.main:app --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 240_000,
    env: {
      PRELEGAL_STATIC_DIR: path.resolve("out"),
      PRELEGAL_DB_PATH: path.join(os.tmpdir(), "prelegal-e2e.db"),
      // Every test signs up its own user from the same address, and the AI call is mocked.
      PRELEGAL_SIGNUPS_PER_HOUR: "100000",
      // Many tests sign in with a wrong password on purpose, all from this one address.
      PRELEGAL_FAILED_LOGINS_PER_ADDRESS: "100000",
      PRELEGAL_CHATS_PER_MINUTE: "100000",
      OPENROUTER_API_KEY: "not-used-in-e2e",
    },
  },
  // Set PLAYWRIGHT_CHANNEL=chrome (or msedge) to use an installed browser instead of `npx playwright install`.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
});
