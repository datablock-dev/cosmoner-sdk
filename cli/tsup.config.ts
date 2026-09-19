import { defineConfig } from "tsup";

/**
 * The SDK's source is bundled in rather than installed as a dependency, so the
 * CLI always carries the validator from its own commit. See README.md.
 *
 * ssh2 is bundled too, so `npx @cosmoner/cli validate` installs nothing new.
 * Its two native addons stay out: they would be built for whichever machine
 * ran the build, and ssh2 falls back to pure JavaScript when they fail to load.
 */
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  target: "node20",
  clean: false,
  noExternal: ["ssh2"],
  external: ["cpu-features", "./crypto/build/Release/sshcrypto.node"],
  // A CLI is executed, not imported: the shebang is what makes `cosmoner`
  // runnable, and `npm` marks the file executable on install.
  banner: { js: "#!/usr/bin/env node" },
});
