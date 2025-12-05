import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve SvelteKit $lib alias for tests
      $lib: path.resolve(__dirname, "ui/src/lib"),
      // Resolve $env alias
      "$env/dynamic/private": path.resolve(__dirname, "ui/src/lib/env-mock.ts"),
    },
  },
  test: {
    // Global setup is optional - only runs if Wrangler is needed
    // API tests in ui/tests/api don't require Wrangler
    globalSetup: "./tests/global-setup.ts",

    // Set environment variables for ALL tests
    env: {
      // Default to dev server (port 8174) - can be overridden for Wrangler tests
      TEST_BASE_URL: process.env.TEST_BASE_URL || "http://localhost:8174",
      // Disable any other ports
      BASE_URL: undefined,
      API_BASE_URL: undefined,
      TEST_URL: undefined,
    },

    // Test timeouts
    testTimeout: 30000,
    hookTimeout: 30000,

    // Reporter options
    reporters: ["default"],

    // Coverage settings
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/**", "tests/**", "**/*.test.ts", "**/*.spec.ts"],
    },
  },
});
