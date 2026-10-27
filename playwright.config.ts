import { defineConfig, devices } from "@playwright/test";

const MOCK = "http://localhost:3199";
const common = {
  SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
  PGLITE_DIR: "memory://",
  DATABASE_URL: "",
  OPENVERSE_API_URL: MOCK,
  WIKIMEDIA_API_URL: MOCK,
  MYMEMORY_API_URL: MOCK,
  GEMINI_API_URL: MOCK,
  WIKTIONARY_API_URL: MOCK,
};

/**
 * E2E runs against the production build (`next build` first — see the test:e2e script).
 * Gemini is per user (each user saves their own key in Settings); Google is replaced by the mock server.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/e2e/mock-server.mjs",
      url: `${MOCK}/get?q=ping`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx next start -p 3100",
      url: "http://localhost:3100/api/health",
      env: common,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
