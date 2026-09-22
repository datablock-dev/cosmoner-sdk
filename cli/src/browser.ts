/**
 * Opening a URL in the user's browser.
 *
 * Its own module so the tests can replace it: a test that ran the real thing
 * would open a browser window on whoever ran the suite.
 */

import { spawn } from "node:child_process";

/**
 * Tries to open `url` in the default browser, returning false when no opener
 * could be started. Best effort by design: the URL is always printed as well,
 * so a machine with no browser — a server over SSH — still gets it.
 */
export function openBrowser(url: string): boolean {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];

  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
