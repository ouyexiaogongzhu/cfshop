import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { applyD1Migrations, env } from "cloudflare:test";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    TEST_MIGRATIONS: D1Migration[];
  }
}

// Runs once before all tests: applies worker/migrations/* to the test D1 DB.
// Provided from vitest.config.ts (`test.provide`, read via readD1Migrations).
await applyD1Migrations(env.DB, inject("TEST_MIGRATIONS"));
