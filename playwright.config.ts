import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
  webServer: [
    {
      command: "npm run preview:resumable-example",
      url: "http://127.0.0.1:4177",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run preview:extract-example",
      url: "http://127.0.0.1:4178",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run preview:permissive-example",
      url: "http://127.0.0.1:4179",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Every example at its own root (browser-tests/examples.spec.ts).
      command: "node examples/serve.mjs",
      url: "http://127.0.0.1:4200",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run preview:router-example",
      url: "http://127.0.0.1:4180",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
