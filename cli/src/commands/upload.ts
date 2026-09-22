/**
 * `cosmoner upload` — copy a local folder onto a shared hosting site over SFTP.
 *
 * Like `deploy`, it reads its API key from the environment. The SFTP password
 * is fetched from the API for the length of the run and never printed, so a CI
 * job needs one secret, not two.
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { CosmonerError, type Cosmoner, type HostingSite } from "@cosmoner/sdk";

import { readChoice, readValue, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { makeClient } from "../credentials";
import { connectSftp, HostKeyMismatchError, type RemoteFs, type SftpTarget } from "../sftp";
import { extraneous, joinRemote, walkLocal, walkRemote, type LocalTree, type Tree } from "../tree";

export const UPLOAD_HELP = `cosmoner upload <site> <dir> [options]

Uploads the contents of <dir> to a web hosting site over SFTP, overwriting
files that already exist. <site> is the site's name or id.

The SFTP login is looked up with the API key, so no password is needed. .git
folders are never uploaded, nor are symlinks.

Options
  --remote <path>      Folder on the site to upload into, as an SFTP client
                       shows it. Defaults to the folder the site's own
                       hostname serves, e.g. /my-site.cosmoner.com/public_html.
  --delete             Afterwards, remove files and folders under the target
                       that are not in <dir>. Refused when the target is /.
  --dry-run            Connect and report what would change, changing nothing.
  --host-key <sha256>  Refuse any server whose host key has another
                       fingerprint. Comma-separate several. Defaults to
                       COSMONER_SFTP_HOST_KEY.
  --project <id>       Project the site is in. Defaults to COSMONER_PROJECT_ID,
                       then the project you logged in to.
  --format <format>    text (default) or json.

Environment
  COSMONER_API_KEY       API key to use instead of cosmoner login. Needs
                         hosting:read.
  COSMONER_PROJECT_ID    Project to use when --project is not given.
  COSMONER_SFTP_HOST_KEY Host key fingerprint(s) to pin, as --host-key.
  COSMONER_API_URL       API base URL. Defaults to https://api.cosmoner.com.

Exit code is 0 when every file was uploaded, 1 when the upload failed or was
refused by the API, and 2 when the command itself was wrong.`;

/** Flags taking a separate value. */
export const UPLOAD_VALUE_FLAGS = ["remote", "host-key", "project", "format"];

/** Flags this command understands. Anything else is a typo worth refusing. */
const FLAGS = [...UPLOAD_VALUE_FLAGS, "delete", "dry-run", "help"];

const FORMATS = ["text", "json"] as const;
type UploadFormat = (typeof FORMATS)[number];

/** Files in flight at once. The gateway and sshd are shared, so this stays modest. */
const PARALLEL_UPLOADS = 4;

/** What an upload changed, or with --dry-run would have. */
interface UploadResult {
  uploaded: string[];
  removed: string[];
  bytes: number;
}

/** Runs `cosmoner upload`, returning the exit code. */
export async function runUpload(args: ParsedArgs, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);

  const [siteRef, dir, ...extra] = args.positional;
  if (siteRef === undefined) throw new UsageError("Name the site to upload to");
  if (dir === undefined) throw new UsageError("Name the folder to upload");
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const localRoot = resolve(cwd, dir);
  const remoteOverride = readRemotePath(args);
  const remove = args.flags.get("delete") === true;
  const dryRun = args.flags.get("dry-run") === true;
  const hostKeys = (readValue(args, "host-key") ?? env.COSMONER_SFTP_HOST_KEY ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const format = readChoice<UploadFormat>(args, "format", FORMATS, "text");

  const client = makeClient(args, env, "hosting:read");
  if (!existsSync(localRoot) || !statSync(localRoot).isDirectory()) {
    throw new UsageError(`${dir} is not a folder`);
  }
  if (remove && remoteOverride === "/") {
    throw new UsageError("--delete with --remote / would remove every other hostname's folder");
  }

  const say = format === "text" ? (line: string) => console.log(line) : () => {};

  try {
    const local = walkLocal(localRoot);
    // An empty folder is almost always a build that produced nothing, and with
    // --delete it would empty the live site.
    if (local.files.length === 0) throw new Error(`${dir} has no files to upload`);

    const site = await findSite(client, siteRef);
    const { data: detail } = await client.hosting.get(site.id, { credentials: true });
    const target = sftpTarget(detail, hostKeys);
    const remoteRoot = remoteOverride ?? defaultRemoteRoot(detail);

    say(`${dryRun ? "Would upload" : "Uploading"} ${dir} to ${site.siteName}:${remoteRoot} (${describeTree(local)})`);
    for (const path of local.skipped) say(`  skipped ${path} (not a regular file or folder)`);

    const connection = await connectSftp(target);
    if (hostKeys.length === 0) {
      say(`  host key ${connection.fingerprint} — pin it with COSMONER_SFTP_HOST_KEY`);
    }

    const startedAt = Date.now();
    let result: UploadResult;
    try {
      result = await sync(connection.fs, localRoot, local, remoteRoot, { remove, dryRun });
    } finally {
      connection.fs.close();
    }

    if (format === "json") {
      console.log(JSON.stringify({ site: { id: site.id, name: site.siteName }, remote: remoteRoot, dryRun, ...result }, null, 2));
    } else if (dryRun) {
      for (const path of result.uploaded) say(`  upload ${path}`);
      for (const path of result.removed) say(`  remove ${path}`);
    } else {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      const removed = remove ? `, removed ${result.removed.length}` : "";
      say(`✓ Uploaded ${result.uploaded.length} files (${formatBytes(result.bytes)})${removed} in ${seconds}s`);
    }
    return 0;
  } catch (err) {
    console.error(explain(err));
    return 1;
  }
}

/**
 * Makes the remote tree match the local one.
 *
 * Uploads first and removes last, so the site is never missing a file it is
 * about to get back. Folders are created before the files that go in them.
 */
async function sync(
  fs: RemoteFs,
  localRoot: string,
  local: LocalTree,
  remoteRoot: string,
  options: { remove: boolean; dryRun: boolean }
): Promise<UploadResult> {
  const rootExists = await ensureRoot(fs, remoteRoot, options.dryRun);
  const remote: Tree = rootExists ? await walkRemote(fs, remoteRoot) : { dirs: [], files: [] };

  assertNoTypeConflicts(local, remote);
  const removals = options.remove ? extraneous(local, remote) : { files: [], dirs: [] };
  const result: UploadResult = {
    uploaded: local.files,
    removed: [...removals.files, ...removals.dirs],
    bytes: local.bytes,
  };
  if (options.dryRun) return result;

  const existingDirs = new Set(remote.dirs);
  for (const dir of local.dirs) {
    if (!existingDirs.has(dir)) await fs.mkdir(joinRemote(remoteRoot, dir));
  }
  await inParallel(local.files, PARALLEL_UPLOADS, (path) =>
    fs.put(join(localRoot, ...path.split("/")), joinRemote(remoteRoot, path))
  );

  for (const path of removals.files) await fs.removeFile(joinRemote(remoteRoot, path));
  for (const path of removals.dirs) await fs.removeDir(joinRemote(remoteRoot, path));
  return result;
}

/** Creates the target folder and any missing parents. Returns whether it already existed. */
async function ensureRoot(fs: RemoteFs, root: string, dryRun: boolean): Promise<boolean> {
  const kind = await fs.kind(root);
  if (kind === "directory") return true;
  if (kind !== null) throw new Error(`${root} exists on the site and is not a folder`);
  if (dryRun) return false;

  let path = "";
  for (const segment of root.split("/").filter(Boolean)) {
    path = `${path}/${segment}`;
    const existing = await fs.kind(path);
    if (existing === null) await fs.mkdir(path);
    else if (existing !== "directory") throw new Error(`${path} exists on the site and is not a folder`);
  }
  return false;
}

/** Refuses a file that would land on a folder, or a folder on a file. */
function assertNoTypeConflicts(local: Tree, remote: Tree): void {
  const remoteDirs = new Set(remote.dirs);
  const remoteFiles = new Set(remote.files);
  const conflict =
    local.files.find((path) => remoteDirs.has(path)) ?? local.dirs.find((path) => remoteFiles.has(path));
  if (conflict !== undefined) {
    throw new Error(`${conflict} is a file on one side and a folder on the other; remove it on the site first`);
  }
}

/** Runs `task` over `items` with at most `limit` in flight, stopping at the first failure. */
async function inParallel<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await task(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Reads --remote as an absolute path on the site.
 *
 * A leading slash is optional, since SFTP clients land in the site's root
 * either way. `..` is refused: the server's chroot would stop it, but a path
 * that means something other than it reads is a mistake worth catching here.
 */
function readRemotePath(args: ParsedArgs): string | undefined {
  const value = readValue(args, "remote");
  if (value === undefined) return undefined;
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new UsageError("--remote may not contain . or .. segments");
  }
  return `/${segments.join("/")}`;
}

/**
 * Finds the site by id or by name.
 *
 * An id is checked first so a site named like another site's id still resolves
 * to the one that id belongs to.
 */
async function findSite(client: Cosmoner, ref: string): Promise<HostingSite> {
  const { data: sites } = await client.hosting.list();
  const site = sites.find((candidate) => candidate.id === ref) ??
    sites.find((candidate) => candidate.siteName === ref);
  if (!site) throw new Error(`No hosting site named "${ref}" in this project`);
  return site;
}

/** Builds the SFTP login for a site, or explains why there is none yet. */
function sftpTarget(
  site: HostingSite & { sftpPassword: string | null },
  hostKeys: string[]
): SftpTarget {
  if (site.status !== "ACTIVE") throw new Error(`${site.siteName} is ${site.status}, not ACTIVE`);
  if (!site.sftpHost) throw new Error("This environment has no SFTP host configured");
  if (!site.unixUser || !site.sftpPassword) throw new Error(`${site.siteName} has no SFTP login yet`);
  return {
    host: site.sftpHost,
    port: site.sftpPort ?? 2222,
    username: site.unixUser,
    password: site.sftpPassword,
    hostKeys,
  };
}

/**
 * The folder the site's own hostname serves, as SFTP shows it.
 *
 * `documentRoot` is the absolute path inside the container; an SFTP login is
 * chrooted to the site's home, so that prefix is what separates the two.
 */
function defaultRemoteRoot(site: HostingSite): string {
  const home = `/var/www/${site.unixUser}`;
  if (!site.documentRoot?.startsWith(`${home}/`)) {
    throw new Error(`${site.siteName} has no document root to upload to; pass --remote`);
  }
  return site.documentRoot.slice(home.length);
}

/** Summarises a local tree for the first line of output. */
function describeTree(tree: LocalTree): string {
  const files = tree.files.length === 1 ? "1 file" : `${tree.files.length} files`;
  return `${files}, ${formatBytes(tree.bytes)}`;
}

/** Formats a byte count the way a person reads it. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A readable message from anything thrown. */
function explain(err: unknown): string {
  if (err instanceof CosmonerError) return `${err.message} (${err.code})`;
  if (err instanceof HostKeyMismatchError) {
    return `${err.message}. If the gateway's key was rotated, update COSMONER_SFTP_HOST_KEY; otherwise do not upload.`;
  }
  return err instanceof Error ? err.message : String(err);
}
