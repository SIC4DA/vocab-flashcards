import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Captures docs/screenshots/* and runs a real-Chromium TTS smoke test (no speech mocks). */
export default defineConfig({
  ...base,
  testDir: "tests/screenshots",
  workers: 1,
  projects: [
    { name: "w1280", use: { browserName: "chromium", channel: "chromium", viewport: { width: 1280, height: 800 } } },
    {
      name: "w390",
      use: { browserName: "chromium", channel: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
});
