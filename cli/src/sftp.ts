/**
 * The SFTP connection `cosmoner upload` works through.
 *
 * Narrowed to the handful of operations the upload needs, so the command can be
 * tested against an in-memory tree instead of a server.
 */

import { createHash } from "node:crypto";

import { Client, type SFTPWrapper } from "ssh2";

/** What sits at a remote path. */
export type RemoteKind = "file" | "directory" | "other";

/** One entry of a remote folder listing. */
export interface RemoteEntry {
  name: string;
  kind: RemoteKind;
}

/** The remote file operations an upload uses. Paths are absolute, POSIX-style. */
export interface RemoteFs {
  /** What is at `path`, or null when nothing is. */
  kind(path: string): Promise<RemoteKind | null>;
  list(path: string): Promise<RemoteEntry[]>;
  mkdir(path: string): Promise<void>;
  put(localPath: string, remotePath: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  close(): void;
}

/** Where to connect and as whom. */
export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  /**
   * Accepted host key fingerprints, `SHA256:<base64>`. Empty accepts any key;
   * the caller learns which one it was from the connection's `fingerprint`.
   */
  hostKeys: string[];
}

/** An open session, and the fingerprint of the key the server presented. */
export interface SftpConnection {
  fs: RemoteFs;
  fingerprint: string;
}

/** Raised when the server's host key is not one of the pinned fingerprints. */
export class HostKeyMismatchError extends Error {
  constructor(readonly fingerprint: string) {
    super(`The server presented host key ${fingerprint}, which is not a pinned key`);
  }
}

const READY_TIMEOUT_MS = 20_000;

// SFTP status codes (draft-ietf-secsh-filexfer-02 §7), as ssh2 reports them.
const NO_SUCH_FILE = 2;

/** The OpenSSH-style SHA256 fingerprint of a raw public key. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/** Normalises a fingerprint as a user might paste it, with or without the prefix and padding. */
export function normaliseFingerprint(value: string): string {
  const body = value.trim().replace(/^SHA256:/i, "").replace(/=+$/, "");
  return `SHA256:${body}`;
}

/** Opens an SFTP session, verifying the host key against `target.hostKeys`. */
export function connectSftp(target: SftpTarget): Promise<SftpConnection> {
  const pinned = target.hostKeys.map(normaliseFingerprint);
  let presented = "";

  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on("error", (err) => {
      reject(presented && pinned.length > 0 && !pinned.includes(presented)
        ? new HostKeyMismatchError(presented)
        : err);
    });
    // Some sshd configurations offer the password prompt as keyboard-interactive
    // rather than password auth; answer it with the same password.
    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => target.password));
    });
    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }
        resolve({ fs: wrap(client, sftp), fingerprint: presented });
      });
    });

    client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      tryKeyboard: true,
      readyTimeout: READY_TIMEOUT_MS,
      hostVerifier: (key: Buffer) => {
        presented = fingerprintOf(key);
        return pinned.length === 0 || pinned.includes(presented);
      },
    });
  });
}

/** Adapts ssh2's callback API to `RemoteFs`. */
function wrap(client: Client, sftp: SFTPWrapper): RemoteFs {
  const call = <T>(path: string, fn: (done: (err: Error | null | undefined, value?: T) => void) => void) =>
    new Promise<T>((resolve, reject) => {
      fn((err, value) => (err ? reject(withPath(err, path)) : resolve(value as T)));
    });

  return {
    kind: (path) =>
      new Promise((resolve, reject) => {
        sftp.stat(path, (err, stats) => {
          if (err) {
            if ((err as { code?: number }).code === NO_SUCH_FILE) resolve(null);
            else reject(withPath(err, path));
            return;
          }
          resolve(kindOf(stats.mode));
        });
      }),
    list: async (path) => {
      const entries = await call<{ filename: string; attrs: { mode: number } }[]>(path, (done) =>
        sftp.readdir(path, done)
      );
      return entries.map((entry) => ({ name: entry.filename, kind: kindOf(entry.attrs.mode) }));
    },
    mkdir: (path) => call<void>(path, (done) => sftp.mkdir(path, done)),
    put: (localPath, remotePath) => call<void>(remotePath, (done) => sftp.fastPut(localPath, remotePath, done)),
    removeFile: (path) => call<void>(path, (done) => sftp.unlink(path, done)),
    removeDir: (path) => call<void>(path, (done) => sftp.rmdir(path, done)),
    close: () => client.end(),
  };
}

/** Reads the file type out of a POSIX mode. */
function kindOf(mode: number): RemoteKind {
  const type = mode & 0o170000;
  if (type === 0o040000) return "directory";
  if (type === 0o100000) return "file";
  return "other";
}

/** Names the path in an SFTP error, which otherwise says only "No such file" or "Failure". */
function withPath(err: Error, path: string): Error {
  return new Error(`${path}: ${err.message}`);
}
