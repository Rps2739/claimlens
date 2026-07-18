import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws outside a React Server Component context, which
      // is the desired build-time behaviour but breaks a plain Node test
      // runner. Swap it for a no-op so server modules stay testable; the real
      // guard is untouched in `next build`.
      "server-only": fileURLToPath(
        new URL("./__tests__/stubs/server-only.ts", import.meta.url)
      ),
    },
  },
  test: {
    // Stubs are helpers, not suites.
    exclude: ["**/node_modules/**", "**/__tests__/stubs/**"],
  },
});
