/**
 * The commands that make a credential: an IAM access key, an SMTP login, a
 * generated SSH key pair.
 *
 * Each prints its secret exactly once — the API keeps no copy (or only a
 * hash), so the create response is the only place it exists. Everything else
 * in the output, and every later read, stays redacted. With `ssh-keys
 * generate --out` the private key goes to a file instead and is not printed
 * at all.
 */

import { existsSync, writeFileSync } from "node:fs";

import type { Cosmoner } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "../args";
import { redact } from "../read/redact";
import { findRow, type ProductAction, type ReadableResource } from "../read/resource";
import { confirm, refusal } from "./confirm";
import { operands, readFormat, runWrite, WRITE_VALUE_FLAGS, type WriteFormat } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.

/** Where the docs send SMTP clients; the API's response does not say. */
const SMTP_SERVER = "smtp.cosmoner.com, port 587 with STARTTLS";

/**
 * Prints a created credential: `lines` and the warning as text, or the API's
 * object as JSON with only `secretField` left unredacted.
 */
function printCredential(format: WriteFormat, data: Row, secretField: string, intro: string, lines: Array<[string, string]>, what: string): void {
  if (format === "json") {
    console.log(JSON.stringify({ ...redact(data), [secretField]: data[secretField] }, null, 2));
    return;
  }
  const width = Math.max(...lines.map(([label]) => label.length)) + 2;
  const body = lines.map(([label, value]) => `  ${`${label}:`.padEnd(width)}${value}`).join("\n");
  console.log(`${intro}\n\n${body}\n\nSave the ${what} now: it is not shown again, and cosmoner never prints it after this.`);
}

/** Splits `a,b` into trimmed, non-empty names. */
function list(value: string | undefined): string[] | undefined {
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

// ─── IAM ────────────────────────────────────────────────────────────────────

/** Resolves bucket names or ids to ids. */
async function bucketIds(client: Cosmoner, refs: string[]): Promise<string[]> {
  const { data: buckets } = await client.buckets.list();
  return refs.map((ref) => {
    const bucket = buckets.find((candidate) => candidate.id === ref || candidate.name === ref);
    if (!bucket) throw new UsageError(`No bucket "${ref}" in this project`);
    return bucket.id;
  });
}

/** Resolves repository names, full paths or ids to ids, across every registry. */
async function repositoryIds(client: Cosmoner, refs: string[]): Promise<string[]> {
  const { data: registries } = await client.registries.list();
  const repositories = registries.flatMap((registry) => registry.repositories ?? []) as Row[];
  return refs.map((ref) => {
    const repository = repositories.find((candidate) => [candidate.id, candidate.name, candidate.fullPath].includes(ref));
    if (!repository) throw new UsageError(`No repository "${ref}" in this project`);
    return repository.id as string;
  });
}

/** "read on assets, logs", or "write on every bucket". */
function grantText(grant: Row | null, every: string, items: Row[] | undefined, nameKey: string): string {
  if (!grant) return "none";
  const names = (items ?? []).map((item) => item[nameKey]);
  return `${grant.access} on ${grant[every] || names.length === 0 ? `every ${nameKey === "bucketName" ? "bucket" : "repository"}` : names.join(", ")}`;
}

export const IAM_CREDENTIAL_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <label> [--storage read|write] [--buckets <bucket,…>] [--registry pull|push] [--repositories <repo,…>]",
    help: `Creates an access key for object storage, the container registry, or both,
and prints its secret once. <label> is 1–20 characters.

  --storage read|write     What it may do with buckets.
  --buckets <bucket,…>     Which buckets, by name or id. Without it: every
                           bucket, including ones created later.
  --registry pull|push     What it may do with registry repositories.
  --repositories <repo,…>  Which repositories, by name or id. Without it: every
                           repository, including ones created later.

The secret access key is printed once — the API keeps no copy — so save it
straight away; every read shows it as [hidden].

Needs iam:write, plus the storage and registry scopes it grants.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "storage", "buckets", "registry", "repositories"],
    run: (args, env) => {
      const [label] = operands(args, ["label"], "iam create <label> --storage read|write");
      if (label.length > 20) throw new UsageError("<label> is at most 20 characters");
      const storage = readValue(args, "storage");
      const registry = readValue(args, "registry");
      if (storage !== undefined && storage !== "read" && storage !== "write") throw new UsageError("--storage must be read or write");
      if (registry !== undefined && registry !== "pull" && registry !== "push") throw new UsageError("--registry must be pull or push");
      if (storage === undefined && registry === undefined) throw new UsageError("Pass --storage, --registry or both");
      const bucketRefs = list(readValue(args, "buckets"));
      const repositoryRefs = list(readValue(args, "repositories"));
      if (bucketRefs && storage === undefined) throw new UsageError("--buckets needs --storage");
      if (repositoryRefs && registry === undefined) throw new UsageError("--repositories needs --registry");
      const format = readFormat(args);

      return runWrite(args, env, "iam:write", async (client) => {
        const { data } = await client.iam.create({
          label,
          storage: storage === undefined ? undefined : { access: storage, bucketIds: bucketRefs && (await bucketIds(client, bucketRefs)) },
          registry: registry === undefined ? undefined : { access: registry, repositoryIds: repositoryRefs && (await repositoryIds(client, repositoryRefs)) },
        });
        printCredential(
          format,
          data,
          "secretAccessKey",
          `Created credential "${data.label}" (${data.iamUserName}).`,
          [
            ["Access key ID", data.accessKeyId],
            ["Secret access key", data.secretAccessKey],
            ["Storage", grantText(data.storage, "allBuckets", data.storage?.buckets, "bucketName")],
            ["Registry", grantText(data.registry, "allRepositories", data.registry?.repositories, "repositoryName")],
          ],
          "secret access key"
        );
        return 0;
      });
    },
  },
};

// ─── SMTP ───────────────────────────────────────────────────────────────────

/** `cosmoner email credentials create|delete`. */
export const EMAIL_CREDENTIAL_ACTIONS: Record<string, ProductAction<Row>> = {
  credentials: {
    usage: "credentials create|delete <domain> …",
    help: `cosmoner email credentials create <domain> --label <label> --from <address>
  Creates an SMTP login for a sending domain and prints its password once.
  --from is the address it sends as, on <domain>. Send through
  ${SMTP_SERVER}.

cosmoner email credentials delete <domain> <credential> [--yes]
  Deletes one, by SMTP username, label or id; anything sending with it stops.
  Asks first; --yes skips the question.

cosmoner email get <domain> lists a domain's credentials.

Needs email:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "label", "from"],
    switches: ["yes"],
    run: (args, env, email) => {
      const verb = args.positional[1];
      if (verb === "create") return createSmtpCredential(args, env, email);
      if (verb === "delete" || verb === "rm") return deleteSmtpCredential(args, env, email);
      throw new UsageError("Name what to do: cosmoner email credentials create|delete <domain>");
    },
  },
};

/** `cosmoner email credentials create <domain> --label --from`. */
function createSmtpCredential(args: ParsedArgs, env: NodeJS.ProcessEnv, email: ReadableResource<Row>): Promise<number> {
  const [, domain] = operands(args, ["verb", "domain"], "email credentials create <domain> --label <label> --from <address>");
  const label = readValue(args, "label");
  const fromAddress = readValue(args, "from");
  if (label === undefined) throw new UsageError("Pass --label");
  if (fromAddress === undefined) throw new UsageError(`Pass --from, an address on ${domain}`);
  const format = readFormat(args);

  return runWrite(args, env, "email:write", async (client) => {
    const row = await findRow(email, client, domain);
    if (!row) return 1;
    const { data } = await client.email.createCredential(row.id as string, { label, fromAddress });
    printCredential(
      format,
      data,
      "smtpPassword",
      `Created SMTP credential "${data.label}", sending as ${data.fromAddress}.`,
      [
        ["Server", SMTP_SERVER],
        ["Username", data.smtpUsername],
        ["Password", data.smtpPassword],
      ],
      "password"
    );
    return 0;
  });
}

/** `cosmoner email credentials delete <domain> <credential>`. */
function deleteSmtpCredential(args: ParsedArgs, env: NodeJS.ProcessEnv, email: ReadableResource<Row>): Promise<number> {
  const [, domain, ref] = operands(args, ["verb", "domain", "credential"], "email credentials delete <domain> <credential>");
  const format = readFormat(args);

  return runWrite(args, env, "email:write", async (client) => {
    const row = await findRow(email, client, domain);
    if (!row) return 1;
    const credentials = ((row.credentials as Row[] | undefined) ?? []);
    const credential = credentials.find((candidate) => [candidate.id, candidate.smtpUsername, candidate.label].includes(ref));
    if (!credential) {
      console.error(`No SMTP credential "${ref}" on ${domain}.`);
      return 1;
    }
    const summary = `This deletes SMTP credential "${credential.label}" (${credential.smtpUsername}). Anything sending with it stops working. It cannot be undone.`;
    const refused = refusal(await confirm(args, summary, `Delete SMTP credential "${credential.label}"?`));
    if (refused !== null) return refused;

    await client.email.deleteCredential(row.id as string, credential.id as string);
    if (format === "json") console.log(JSON.stringify({ deleted: redact(credential) }, null, 2));
    else console.log(`Deleted SMTP credential "${credential.label}".`);
    return 0;
  });
}

// ─── SSH keys ───────────────────────────────────────────────────────────────

export const SSH_KEY_GENERATE_ACTIONS: Record<string, ProductAction<Row>> = {
  generate: {
    usage: "generate <name> [--out <file>]",
    help: `Generates an RSA 4096 key pair and adds its public half to the project. The
API never stores the private key, so this is the only time it exists.

  --out <file>  Write the private key to <file> (mode 600) and the public key
                to <file>.pub, and print neither. Refuses to overwrite.

Without --out the private key is printed once. Prefer cosmoner ssh-keys create
with a key you made yourself: then the private key never leaves your machine.

Needs servers:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "out"],
    run: (args, env) => {
      const [name] = operands(args, ["key name"], "ssh-keys generate <name>");
      const out = readValue(args, "out");
      if (out !== undefined && (existsSync(out) || existsSync(`${out}.pub`))) {
        throw new UsageError(`${out} or ${out}.pub already exists; choose another --out`);
      }
      const format = readFormat(args);

      return runWrite(args, env, "servers:write", async (client) => {
        const { data } = await client.sshKeys.generate({ name });
        if (out !== undefined) {
          writeFileSync(out, data.privateKey, { mode: 0o600, flag: "wx" });
          writeFileSync(`${out}.pub`, `${data.publicKey}\n`, { flag: "wx" });
          if (format === "json") console.log(JSON.stringify({ ...redact(data), privateKeyFile: out }, null, 2));
          else console.log(`Generated ssh-key "${data.name}" (${data.fingerprint}). Wrote the private key to ${out} and the public key to ${out}.pub.`);
          return 0;
        }
        if (format === "json") {
          console.log(JSON.stringify({ ...redact(data), privateKey: data.privateKey }, null, 2));
          return 0;
        }
        console.log(`Generated ssh-key "${data.name}" (${data.fingerprint}). Its private key:\n\n${data.privateKey.trimEnd()}\n\nSave the private key now: it is not shown again, and cosmoner never prints it after this.`);
        return 0;
      });
    },
  },
};
