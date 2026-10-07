/**
 * `cosmoner use` — set the project commands act on by default.
 *
 * A CLI session reaches every project its user is a member of, so a command
 * has to be told which one. `--project` says it once; this says it for every
 * command after, on this machine, for this API URL.
 */

import { rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { apiUrl, freshSession, isExpired, isLegacyLogin, readLogin, saveLogin, type SavedProject } from "../credentials";

export const USE_HELP = `cosmoner use [<project>]

Sets the project that deploy, upload, secrets and variables act on when no
--project is given. <project> is the project's slug or id, and it is checked
against the API, so a typo is caught here rather than at the next deploy.

With no <project>, shows the current default.

--project and COSMONER_PROJECT_ID still take priority over this default.`;

const FLAGS = ["help", "clear"];

/** What `GET /v1/projects/:project` returns, as far as this command reads it. */
interface Project {
  id: string;
  name: string;
  slug?: string | null;
}

/** Runs `cosmoner use`, returning the exit code. */
export async function runUse(args: ParsedArgs, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, FLAGS);
  const [ref, ...extra] = args.positional;
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const login = readLogin(env);
  if (!login) throw new UsageError("Run cosmoner login first");
  if (isExpired(login)) throw new UsageError("Your CLI login has expired. Run cosmoner login again");
  if (isLegacyLogin(login)) {
    // A key saved by an older CLI reaches one project and nothing else, so
    // there is nothing to choose between.
    throw new UsageError(`Your saved login is a key for ${login.projectName} only. Run cosmoner login to use your other projects`);
  }

  if (args.flags.get("clear") === true) {
    if (ref !== undefined) throw new UsageError("Pass a project or --clear, not both");
    const { defaultProject: _cleared, ...rest } = login;
    saveLogin(env, rest);
    console.log("Cleared the default project.");
    return 0;
  }

  if (ref === undefined) {
    if (!login.defaultProject) {
      console.log("No default project. Set one with cosmoner use <project>.");
      return 0;
    }
    const { name, slug, id } = login.defaultProject;
    console.log(`Default project: ${name} (${slug ?? id})`);
    return 0;
  }

  const session = await freshSession(env, login, 60_000);
  const response = await fetch(`${apiUrl(env)}/v1/projects/${encodeURIComponent(ref)}`, {
    headers: { Authorization: `Bearer ${session.accessToken}`, Accept: "application/json" },
  });
  if (response.status === 403 || response.status === 404) {
    console.error(`No project "${ref}" among the projects you are a member of.`);
    return 1;
  }
  if (!response.ok) {
    console.error(`Could not look up "${ref}": HTTP ${response.status}`);
    return 1;
  }

  const { data } = (await response.json()) as { data: Project };
  const project: SavedProject = { id: data.id, slug: data.slug ?? null, name: data.name };
  saveLogin(env, { ...session, defaultProject: project });
  console.log(`Using ${project.name} (${project.slug ?? project.id}) by default.`);
  return 0;
}
