import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["*.spec.ts"],
  reporter: "list",
  timeout: 30_000,
  use: {
    trace: "retain-on-failure",
  },
});
