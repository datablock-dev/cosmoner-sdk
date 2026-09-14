import { defineConfig } from "tsup";

/**
 * The SDK's source is bundled in rather than installed as a dependency, so the
 * CLI always carries the validator from its own commit. See README.md.
 */
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  target: "node20",
  clean: false,
  // A CLI is executed, not imported: the shebang is what makes `cosmoner`
  // runnable, and `npm` marks the file executable on install.
  banner: { js: "#!/usr/bin/env node" },
});
