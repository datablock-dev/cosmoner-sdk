/**
 * The two file trees an upload compares: the local folder and the remote one.
 *
 * Paths inside a tree are relative and POSIX-style (`css/site.css`), whatever
 * the local platform, so the two sides compare directly.
 */

import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { RemoteFs } from "./sftp";

/** A folder's contents, listed parents before children. */
export interface Tree {
  dirs: string[];
  files: string[];
}

/** A local tree, with the bytes it holds and what the walk left out. */
export interface LocalTree extends Tree {
  bytes: number;
  /** Symlinks and special files, which are not uploaded. */
  skipped: string[];
}

/**
 * Names never uploaded from any folder.
 *
 * `.git` is here because the target is a public web root: a repository pointed
 * at by mistake would publish its whole history.
 */
export const ALWAYS_EXCLUDED = [".git"];

/** Walks a local folder. */
export function walkLocal(root: string): LocalTree {
  const tree: LocalTree = { dirs: [], files: [], bytes: 0, skipped: [] };

  const visit = (relative: string) => {
    const names = readdirSync(join(root, relative)).toSorted();
    for (const name of names) {
      if (ALWAYS_EXCLUDED.includes(name)) continue;
      const path = relative ? `${relative}/${name}` : name;
      const stats = lstatSync(join(root, path));
      if (stats.isDirectory()) {
        tree.dirs.push(path);
        visit(path);
      } else if (stats.isFile()) {
        tree.files.push(path);
        tree.bytes += stats.size;
      } else {
        tree.skipped.push(path);
      }
    }
  };

  visit("");
  return tree;
}

/** Walks a remote folder, which must exist. */
export async function walkRemote(fs: RemoteFs, root: string): Promise<Tree> {
  const tree: Tree = { dirs: [], files: [] };

  const visit = async (relative: string) => {
    const entries = await fs.list(joinRemote(root, relative));
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "." || entry.name === "..") continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        tree.dirs.push(path);
        await visit(path);
      } else {
        tree.files.push(path);
      }
    }
  };

  await visit("");
  return tree;
}

/**
 * What exists remotely but not locally, in the order it can be removed.
 *
 * Files first, then folders deepest first, so each folder is empty by the time
 * it is removed.
 */
export function extraneous(local: Tree, remote: Tree): Tree {
  const localFiles = new Set(local.files);
  const localDirs = new Set(local.dirs);
  return {
    files: remote.files.filter((path) => !localFiles.has(path)),
    dirs: remote.dirs.filter((path) => !localDirs.has(path)).toReversed(),
  };
}

/** Joins a relative tree path onto an absolute remote root. */
export function joinRemote(root: string, relative: string): string {
  if (!relative) return root;
  return root === "/" ? `/${relative}` : `${root}/${relative}`;
}
