import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests run against PGlite — a real Postgres, in memory, no server to install.
 * DB_DRIVER is set here so src/lib/db.ts never reaches for DATABASE_URL.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { DB_DRIVER: "pglite" },
    // Each file gets its own PGlite; they are heavy, so run them in sequence.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
