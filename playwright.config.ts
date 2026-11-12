import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8788", locale: "fr-BE", acceptDownloads: true },
  webServer: { command: "node scripts/e2e-server.mjs", url: "http://127.0.0.1:8788/api/health", reuseExistingServer: false, timeout: 60_000 },
  projects: [
    { name: "ordinateur", use: { viewport: { width: 1440, height: 900 } } },
    { name: "tablette", use: { ...devices["iPad (gen 7) landscape"], browserName: "chromium" }, testMatch: /responsive/ },
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" }, testMatch: /responsive/ },
  ],
});
