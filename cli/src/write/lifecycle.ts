/**
 * The verbs that change something already there: renaming a server or a
 * project, powering a server, setting a domain up for email, and rotating a
 * shared database's password.
 *
 * Three of them ask first. Stopping and rebooting a server take whatever runs
 * on it offline, rotating a password breaks every connection still using the
 * old one, and the first email verification on a plan with a monthly price
 * bills it. Starting a server, renaming and setting a domain up cost nothing
 * and are undone as easily, so they run straight away.
 */

import type { Cosmoner } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "../args";
import { findRow, type ProductAction, type ReadableResource } from "../read/resource";
import { confirm, refusal } from "./confirm";
import { printCredential } from "./credentials";
import { operands, printResult, readFormat, runWrite, WRITE_VALUE_FLAGS, type WriteFormat } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.

/** Reads the `--name` an update needs. */
function newName(args: ParsedArgs): string {
  const name = readValue(args, "name");
  if (name === undefined) throw new UsageError("Pass --name <new name>");
  return name;
}

// ─── Servers ────────────────────────────────────────────────────────────────

type PowerVerb = "start" | "stop" | "reboot";

/** What each power verb calls, says, and whether it asks first. */
const POWER: Record<PowerVerb, { call: (client: Cosmoner, id: string) => Promise<{ data: Row }>; done: string; ask?: string; help: string }> = {
  start: {
    call: (client, id) => client.servers.powerOn(id),
    done: "Starting",
    help: `Powers a stopped server on.`,
  },
  stop: {
    call: (client, id) => client.servers.powerOff(id),
    done: "Stopping",
    ask: "cuts its power at once, like pulling the plug: anything running on it stops without shutting down cleanly. A stopped server is still billed.",
    help: `Cuts a running server's power — a hard stop, not a shutdown its operating
system sees coming. A stopped server is still billed; delete it to stop that.
Asks first; --yes skips the question.`,
  },
  reboot: {
    call: (client, id) => client.servers.reboot(id),
    done: "Rebooting",
    ask: "restarts it: anything running on it is offline until it is back up.",
    help: `Restarts a running server. Asks first; --yes skips the question.`,
  },
};

/** One power verb as a product action. */
function powerAction(verb: PowerVerb): ProductAction<Row> {
  const { call, done, ask, help } = POWER[verb];
  return {
    usage: `${verb} <server>${ask ? " [--yes]" : ""}`,
    help: `${help}

The server reads PROVISIONING until it settles; cosmoner servers get <server>
shows where it ended up. Refused while it is still being created.

Needs servers:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ask ? ["yes"] : [],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["server"], `servers ${verb} <server>`);
      const format = readFormat(args);

      return runWrite(args, env, "servers:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        if (ask) {
          const refused = refusal(await confirm(args, `This ${verb === "stop" ? "stops" : "reboots"} server "${row.name}". It ${ask}`, `${verb === "stop" ? "Stop" : "Reboot"} server "${row.name}"?`));
          if (refused !== null) return refused;
        }
        const { data } = await call(client, row.id as string);
        printResult(format, data, `${done} server "${row.name}". Run cosmoner servers get ${row.name} to see when it has settled.`);
        return 0;
      });
    },
  };
}

/** `cosmoner servers update|start|stop|reboot`. */
export const SERVER_ACTIONS: Record<string, ProductAction<Row>> = {
  update: {
    usage: "update <server> --name <new-name>",
    help: `Renames a server: lowercase letters, digits and hyphens. Free.

Needs servers:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "name"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["server"], "servers update <server> --name <new-name>");
      const name = newName(args);
      const format = readFormat(args);

      return runWrite(args, env, "servers:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const { data } = await client.servers.update(row.id as string, { name });
        printResult(format, data, `Renamed server "${row.name}" to "${data.name}".`);
        return 0;
      });
    },
  },
  start: powerAction("start"),
  stop: powerAction("stop"),
  reboot: powerAction("reboot"),
};

// ─── Projects ───────────────────────────────────────────────────────────────

/** `cosmoner projects update`. */
export const PROJECT_ACTIONS: Record<string, ProductAction<Row>> = {
  update: {
    usage: "update <project> --name <new-name>",
    help: `Renames a project. Its slug and id stay the same, so nothing that refers to
it breaks. Owners and admins only.

Needs projects:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "name"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["project"], "projects update <project> --name <new-name>");
      const name = newName(args);
      const format = readFormat(args);

      return runWrite(
        args,
        env,
        "projects:write",
        async (client) => {
          const row = await findRow(resource, client, ref);
          if (!row) return 1;
          const { data } = await client.projects.update(row.id as string, { name });
          printResult(format, data, `Renamed project "${row.name}" to "${data.name}".`);
          return 0;
        },
        { requireProject: false }
      );
    },
  },
};

// ─── Email ──────────────────────────────────────────────────────────────────

/** Prints the records a sending domain needs, one block per record. */
function recordLines(records: Row[], state?: (record: Row) => string): string {
  return records
    .map((record) => `  ${record.type}  ${record.name}  (${record.purpose})${state ? `  ${state(record)}` : ""}\n       ${record.value}`)
    .join("\n\n");
}

/** What the project's email plan bills when sending is first turned on. */
function planText(limits: Row): string {
  const plan = String(limits.plan).toLowerCase().replace(/_/g, " ");
  return limits.includedEmails > 0
    ? `the ${plan} email plan: its monthly price, covering ${limits.includedEmails} emails a month, and each email beyond them`
    : `the ${plan} email plan: each email sent, with nothing up front`;
}

/** `cosmoner email create|verify`, beside `email credentials`. */
export const EMAIL_DOMAIN_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <domain>",
    help: `Sets a domain up for sending email and prints the DNS records to publish.
Free. A domain already in the project is used as it is; any other is added to
the project as pending, for DNS you host elsewhere. Then run
cosmoner email verify <domain>.

Needs email:write and domains:read.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    run: (args, env) => {
      const [name] = operands(args, ["domain"], "email create <domain>");
      const format = readFormat(args);

      return runWrite(args, env, "email:write", async (client) => {
        const { data: domains } = await client.domains.list();
        const domain = domains.find((candidate) => candidate.name === name.toLowerCase() || candidate.id === name);
        const { data } = domain
          ? await client.email.createDomain({ domainId: domain.id })
          : await client.email.createExternalDomain({ domainName: name });
        printResult(
          format,
          data,
          `Set up ${data.domain.name} for email. Publish these DNS records:

${recordLines(data.dnsRecords)}

Then run cosmoner email verify ${data.domain.name}.`
        );
        return 0;
      });
    },
  },

  verify: {
    usage: "verify <domain> [--yes]",
    help: `Checks a sending domain's DNS records, and turns sending on once they all
resolve. Exits 1 while any is missing; DNS changes can take a while.

The first time sending is turned on, the project's email plan goes on its
subscription. On a plan with a monthly price that is charged, so this asks
first; --yes skips the question.

Needs email:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ["yes"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["domain"], "email verify <domain>");
      const format = readFormat(args);

      return runWrite(args, env, "email:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const name = row.domain?.name ?? ref;
        const { data: detail } = await client.email.getDomain(row.id as string);
        if (detail.sending.billingRequired) {
          const { data: limits } = await client.email.limits();
          if (limits.includedEmails > 0) {
            const summary = `Once ${name}'s records resolve, this turns sending on and bills ${planText(limits)}.`;
            const refused = refusal(await confirm(args, summary, `Verify ${name} and start billing the email plan?`));
            if (refused !== null) return refused;
          }
        }
        const { data } = await client.email.verifyDomain(row.id as string);
        const active = data.status === "ACTIVE";
        printVerification(format, data, name, active);
        return active ? 0 : 1;
      });
    },
  },
};

/** Whether `email verify` found a record, and why not. */
function recordState(record: Row): string {
  return record.verified ? "found" : `not found${record.error ? `: ${record.error}` : ""}`;
}

/** Prints what `email verify` found. */
function printVerification(format: WriteFormat, data: Row, name: string, active: boolean): void {
  printResult(
    format,
    data,
    active
      ? `${name} is verified and can send.`
      : `${name} is not verified yet:\n\n${recordLines(data.records as Row[], recordState)}`
  );
}

// ─── Databases ──────────────────────────────────────────────────────────────

/** `cosmoner databases rotate-password`. */
export const DATABASE_ACTIONS: Record<string, ProductAction<Row>> = {
  "rotate-password": {
    usage: "rotate-password <database> [--yes]",
    help: `Replaces a shared database's password and prints the new one once. The old
password stops working at once, so anything still connecting with it fails
until it has the new one. Asks first; --yes skips the question.

Shared databases only.

Needs databases:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ["yes"],
    run: (args, env, resource: ReadableResource<Row>) => {
      const [ref] = operands(args, ["database"], "databases rotate-password <database>");
      const format = readFormat(args);

      return runWrite(args, env, "databases:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        if (row.kind === "DEDICATED") throw new UsageError(`"${row.name}" is a dedicated database; rotate-password works on shared databases only`);
        const summary = `This replaces the password of database "${row.name}". Anything connecting with the current one fails until it has the new one.`;
        const refused = refusal(await confirm(args, summary, `Rotate the password of "${row.name}"?`));
        if (refused !== null) return refused;
        const { data } = await client.databases.rotateSharedPassword(row.id as string);
        printCredential(
          format,
          data,
          ["password", "connectionUri"],
          `Rotated the password of database "${row.name}".`,
          [
            ["Password", data.password],
            ["Connection URI", data.connectionUri],
          ],
          "password"
        );
        return 0;
      });
    },
  },
};
