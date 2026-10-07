/**
 * The product verbs beyond get, list and delete.
 *
 * Every verb here is free and reversible, so none of them asks first — except
 * rotating a webhook's signing secret, which breaks verification at the
 * receiver the moment it runs.
 *
 * Two of them print a credential: creating a webhook and rotating its secret
 * return the signing secret, which the API never shows again. They print it
 * once, on purpose — the response is the only copy, and every read keeps it
 * hidden.
 */

import { readFileSync } from "node:fs";

import { WEBHOOK_EVENT_TYPES, type Cosmoner, type UpdateAppParams, type WebhookEventType } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "../args";
import { redact } from "../read/redact";
import { findRow, type ProductAction } from "../read/resource";
import { readStdin } from "../stdin";
import { confirm, refusal } from "./confirm";
import { operands, printResult, readFormat, runWrite, WRITE_VALUE_FLAGS } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.

const SECRET_WARNING = "Save it now: it is not shown again, and cosmoner never prints it after this.";

// ─── SSH keys ───────────────────────────────────────────────────────────────

/** `cosmoner ssh-keys create <name> --public-key <file>`. */
export const SSH_KEY_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --public-key <file|->",
    help: `Adds a public key to the project, for servers created after it. <file>
is an OpenSSH public key, such as ~/.ssh/id_ed25519.pub; - reads it from
stdin. Never pass the private key.

Needs servers:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "public-key"],
    run: (args, env) => {
      const [name] = operands(args, ["key name"], "ssh-keys create <name> --public-key <file>");
      const source = readValue(args, "public-key");
      if (source === undefined) throw new UsageError("Pass --public-key <file>, or --public-key - to read stdin");
      const publicKey = (source === "-" ? readStdin() : readFileSync(source, "utf8")).trim();
      if (publicKey.includes("PRIVATE KEY")) throw new UsageError("That is a private key. Pass the .pub file");
      const format = readFormat(args);

      return runWrite(args, env, "servers:write", async (client) => {
        const { data } = await client.sshKeys.create({ name, publicKey });
        printResult(format, data, `Added ssh-key "${data.name}" (${data.fingerprint}).`);
        return 0;
      });
    },
  },
};

// ─── Domains ────────────────────────────────────────────────────────────────

/** `cosmoner domains create|verify`. */
export const DOMAIN_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <domain>",
    help: `Adds a domain you already own, such as example.com. Free. It prints the
TXT record that proves you own it; publish that at your DNS provider, then
run cosmoner domains verify <domain>.

Needs domains:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    run: (args, env) => {
      const [name] = operands(args, ["domain"], "domains create <domain>");
      const format = readFormat(args);

      return runWrite(args, env, "domains:write", async (client) => {
        const { data } = await client.domains.create(name);
        const record = data.verificationRecord;
        printResult(
          format,
          data,
          `Added ${data.name}. To verify it, publish this DNS record:

  ${record.type}  ${record.name}  ${record.value}

Then run cosmoner domains verify ${data.name}.`
        );
        return 0;
      });
    },
  },

  verify: {
    usage: "verify <domain>",
    help: `Checks a domain's TXT record and marks it verified when it is found.
Exits 1 while the record is not visible yet; DNS changes can take a while.

Needs domains:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    run: (args, env) => {
      const [domain] = operands(args, ["domain"], "domains verify <domain>");
      const format = readFormat(args);

      return runWrite(args, env, "domains:write", async (client) => {
        const { data } = await client.domains.verify(domain);
        const record = data.record;
        printResult(
          format,
          data,
          data.verified
            ? `${domain} is verified.`
            : `${domain} is not verified yet: ${record.type} ${record.name} was not found${data.error ? ` (${data.error})` : ""}.`
        );
        return data.verified ? 0 : 1;
      });
    },
  },
};

// ─── Webhooks ───────────────────────────────────────────────────────────────

/** Reads `--events a,b` into checked event types. */
function readEvents(args: ParsedArgs): WebhookEventType[] | undefined {
  const raw = readValue(args, "events");
  if (raw === undefined) return undefined;
  const events = raw.split(",").map((event) => event.trim()).filter(Boolean);
  const unknown = events.find((event) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(event));
  if (unknown !== undefined) {
    throw new UsageError(`Unknown event "${unknown}". Events: ${WEBHOOK_EVENT_TYPES.join(", ")}`);
  }
  if (events.length === 0) throw new UsageError("--events needs at least one event");
  return events as WebhookEventType[];
}

/** Prints a signing secret the API returned, once. */
function printSecret(format: "text" | "json", data: Row, intro: string): void {
  if (format === "json") {
    // Everything else stays redacted; the secret is the one value this command exists to hand over.
    console.log(JSON.stringify({ ...redact(data), secret: data.secret }, null, 2));
    return;
  }
  console.log(`${intro}\n\n  Signing secret:  ${data.secret}\n\n${SECRET_WARNING}`);
}

/** Resolves a webhook by name or id, or returns null after saying it was not found. */
async function webhookId(client: Cosmoner, resource: Parameters<typeof findRow<Row>>[0], ref: string): Promise<string | null> {
  const row = await findRow(resource, client, ref);
  return row ? (row.id as string) : null;
}

const EVENTS_HELP = `Events: ${WEBHOOK_EVENT_TYPES.join(", ")}.`;

/** `cosmoner webhooks create|update|test|rotate-secret`. */
export const WEBHOOK_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --url <https-url> --events <event,…> [--description <text>]",
    help: `Creates an endpoint that receives the listed events. It prints the signing
secret once, to verify deliveries with; it is never shown again.
${EVENTS_HELP}

Needs webhooks:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "url", "events", "description"],
    run: (args, env) => {
      const [name] = operands(args, ["webhook name"], "webhooks create <name> --url <url> --events <event,…>");
      const url = readValue(args, "url");
      if (url === undefined) throw new UsageError("Pass --url <https-url>");
      const events = readEvents(args);
      if (events === undefined) throw new UsageError("Pass --events <event,…>");
      const description = readValue(args, "description");
      const format = readFormat(args);

      return runWrite(args, env, "webhooks:write", async (client) => {
        const { data } = await client.webhooks.create({ name, url, events, description });
        printSecret(format, data, `Created webhook "${data.name}" for ${data.events.join(", ")}.`);
        return 0;
      });
    },
  },

  update: {
    usage: "update <webhook> [--name <name>] [--url <url>] [--events <event,…>] [--description <text>] [--enable | --disable]",
    help: `Changes an endpoint. --enable also clears an automatic pause.

Needs webhooks:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "name", "url", "events", "description"],
    switches: ["enable", "disable"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["webhook"], "webhooks update <webhook> [options]");
      const enable = args.flags.get("enable") === true;
      const disable = args.flags.get("disable") === true;
      if (enable && disable) throw new UsageError("Pass --enable or --disable, not both");
      const changes = {
        name: readValue(args, "name"),
        url: readValue(args, "url"),
        events: readEvents(args),
        description: readValue(args, "description"),
        enabled: enable ? true : disable ? false : undefined,
      };
      if (Object.values(changes).every((value) => value === undefined)) {
        throw new UsageError("Name a change: --name, --url, --events, --description, --enable or --disable");
      }
      const format = readFormat(args);

      return runWrite(args, env, "webhooks:write", async (client) => {
        const id = await webhookId(client, resource, ref);
        if (id === null) return 1;
        const { data } = await client.webhooks.update(id, changes);
        printResult(format, data, `Updated webhook "${data.name}".`);
        return 0;
      });
    },
  },

  test: {
    usage: "test <webhook> [--event <event>]",
    help: `Sends a sample event and reports what the endpoint answered. Exits 1 when
the delivery failed. Defaults to the endpoint's first event.

Needs webhooks:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "event"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["webhook"], "webhooks test <webhook>");
      const event = readValue(args, "event");
      if (event !== undefined && !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(event)) {
        throw new UsageError(`Unknown event "${event}". ${EVENTS_HELP}`);
      }
      const format = readFormat(args);

      return runWrite(args, env, "webhooks:write", async (client) => {
        const id = await webhookId(client, resource, ref);
        if (id === null) return 1;
        const { data } = await client.webhooks.test(id, { eventType: event as WebhookEventType | undefined });
        const delivery = data.delivery as Row;
        const succeeded = delivery.status === "SUCCEEDED";
        const answer = delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : (delivery.errorMessage ?? "no answer");
        printResult(format, data, `${succeeded ? "Delivered" : "Failed"}: ${delivery.eventType} to "${ref}" (${answer}).`);
        return succeeded ? 0 : 1;
      });
    },
  },

  "rotate-secret": {
    usage: "rotate-secret <webhook> [--yes]",
    help: `Issues a new signing secret and prints it once. The old secret stops
verifying immediately, so deliveries fail at the receiver until it has the new
one. Asks first; --yes skips the question.

Needs webhooks:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ["yes"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["webhook"], "webhooks rotate-secret <webhook>");
      const format = readFormat(args);

      return runWrite(args, env, "webhooks:write", async (client) => {
        const id = await webhookId(client, resource, ref);
        if (id === null) return 1;
        const summary = `This replaces the signing secret of webhook "${ref}". The current secret stops verifying at once.`;
        const refused = refusal(await confirm(args, summary, `Rotate the secret of "${ref}"?`));
        if (refused !== null) return refused;
        const { data } = await client.webhooks.rotateSecret(id);
        printSecret(format, data, `Rotated the signing secret of webhook "${ref}".`);
        return 0;
      });
    },
  },
};

// ─── Apps ───────────────────────────────────────────────────────────────────

const POLICIES = { tag: "TAG", newest: "NEWEST", manual: "MANUAL" } as const;

/**
 * A flag's value, allowing an empty one: `--build-command ""` means clear it.
 * `readValue` refuses empty values, which is right everywhere else.
 */
function readClearable(args: ParsedArgs, flag: string): string | undefined {
  const value = args.flags.get(flag);
  if (value === true) throw new UsageError(`--${flag} needs a value`);
  return value;
}

/** A flag's value as a nullable string: an empty value clears the setting. */
function nullable(args: ParsedArgs, flag: string): string | null | undefined {
  const value = readClearable(args, flag);
  return value === undefined ? undefined : value === "" ? null : value;
}

/** A flag's value as a positive whole number, or null when it is empty and `clearable`. */
function count(args: ParsedArgs, flag: string, clearable: boolean): number | null | undefined {
  const value = clearable ? readClearable(args, flag) : readValue(args, flag);
  if (value === undefined) return undefined;
  if (value === "" && clearable) return null;
  if (!/^[1-9]\d*$/.test(value)) throw new UsageError(`--${flag} must be a whole number above 0`);
  return Number(value);
}

/** `cosmoner apps update`. */
export const APP_ACTIONS: Record<string, ProductAction<Row>> = {
  update: {
    usage: "update <app> [options]",
    help: `Changes an app's settings and applies them. Free; resizing is not here.
An empty value, such as --build-command "", clears a setting.

  --name <name>
  --instances <n>              Not every runtime scales horizontally.
  --build-command <command>
  --run-command <command>
  --output-dir <dir>
  --public-port <port>
  --internal-port <port>
  --auto-deploy on|off         Deploy on every push to the branch.
  --image-deploy-policy tag|newest|manual

Environment variables belong in the deployment file and are not set here.

Needs apps:write.`,
    valueFlags: [
      ...WRITE_VALUE_FLAGS,
      "name",
      "instances",
      "build-command",
      "run-command",
      "output-dir",
      "public-port",
      "internal-port",
      "auto-deploy",
      "image-deploy-policy",
    ],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["app"], "apps update <app> [options]");
      const autoDeploy = readValue(args, "auto-deploy");
      if (autoDeploy !== undefined && autoDeploy !== "on" && autoDeploy !== "off") {
        throw new UsageError("--auto-deploy must be on or off");
      }
      const policy = readValue(args, "image-deploy-policy");
      if (policy !== undefined && !(policy in POLICIES)) {
        throw new UsageError("--image-deploy-policy must be tag, newest or manual");
      }
      const changes: UpdateAppParams = {
        name: readValue(args, "name"),
        instances: count(args, "instances", false) ?? undefined,
        buildCommand: nullable(args, "build-command"),
        runCommand: nullable(args, "run-command"),
        outputDir: nullable(args, "output-dir"),
        publicPort: count(args, "public-port", true),
        internalPort: count(args, "internal-port", true),
        autoDeploy: autoDeploy === undefined ? undefined : autoDeploy === "on",
        imageDeployPolicy: policy === undefined ? undefined : POLICIES[policy as keyof typeof POLICIES],
      };
      if (Object.values(changes).every((value) => value === undefined)) {
        throw new UsageError("Name a change; cosmoner apps --help lists them");
      }
      const format = readFormat(args);

      return runWrite(args, env, "apps:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const { data } = await client.apps.update(row.id as string, changes);
        printResult(format, data, `Updated app "${data.name}".`);
        return 0;
      });
    },
  },
};
