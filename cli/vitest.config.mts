import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The CLI is built against the SDK's source, not a published package — see
 * README.md for why. tsup and tsc both pick that up from the `paths` entry in
 * tsconfig.json; Vitest needs to be told separately.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@cosmoner/sdk": fileURLToPath(new URL("../javascript/src/index.ts", import.meta.url)),
    },
  },
});
