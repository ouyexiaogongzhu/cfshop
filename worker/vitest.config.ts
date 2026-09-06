import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // Read migrations on the Node side; tests/apply-migrations.ts applies them
  // to the test D1 database before any test runs.
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
    test: {
      setupFiles: ["./tests/apply-migrations.ts"],
      provide: { TEST_MIGRATIONS: migrations },
    },
  };
});
