/**
 * SDK version, used to build the User-Agent header.
 *
 * Written here rather than read from package.json because this module is
 * bundled into consumers' builds, where there is no manifest to read at
 * runtime. That makes it a second place the version lives, so it is not
 * maintained by hand: `scripts/sync-version.mjs` rewrites it from package.json,
 * the release workflow runs that straight after `npm version`, and
 * `version.test.ts` fails the build if the two ever disagree.
 */
export const VERSION = "1.3.0";

export const USER_AGENT = `cosmoner-node/${VERSION}`;
