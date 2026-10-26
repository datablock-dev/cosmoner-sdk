/**
 * The verbs that change something already there: renaming a server or a
 * project, powering a server, setting a domain up for email, rotating a
 * shared database's password, and moving a hosting site's image, PHP version
 * and email.
 *
 * Several of them ask first. Stopping and rebooting a server take whatever
 * runs on it offline, rotating a password breaks every connection still using
 * the old one, and the first email verification on a plan with a monthly
 * price bills it. A hosting site's image update, rollback and PHP version
 * change each restart the site, turning its email on bills every message, and
 * turning it off deletes the credential it sends with. Starting a server,
 * renaming and setting a domain up cost nothing and are undone as easily, so
 * they run straight away.
 */

import type { Cosmoner, HostingImageStatus, HostingMailStatus } from "@cosmoner/sdk";

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

// ─── Hosting ────────────────────────────────────────────────────────────────

const RESTART_NOTE = "The site restarts onto it, which interrupts it for a few seconds.";

/** A build as `8.4-20261025`, or a stand-in for a site whose build was never pinned. */
function buildName(build: { tag: string | null; phpVersion: string }): string {
  return build.tag ?? `an unpinned PHP ${build.phpVersion} build`;
}

/** What `hosting image` prints in text: where the site stands, one fact per line. */
function imageText(name: string, status: HostingImageStatus): string {
  const { current, update, forcedUpdate, rollback, php } = status;
  const lines = [`Site "${name}" runs PHP ${php.version}, build ${buildName(current)}${status.updatedAt ? `, since ${status.updatedAt.slice(0, 10)}` : ""}.`];
  if (update) {
    const fixes = [update.phpPatch && update.phpRelease ? `PHP ${update.phpPatch}` : "", ...update.cves].filter(Boolean);
    const severity = [update.critical ? "critical" : "", update.knownExploited ? "known exploited" : ""].filter(Boolean).join(", ");
    lines.push(`Update available: ${update.tag}${fixes.length > 0 ? ` (${fixes.join(", ")})` : ""}${severity ? ` — ${severity}` : ""}. cosmoner hosting update ${name} applies it.`);
  } else {
    lines.push("It runs the newest build of its PHP version.");
  }
  if (forcedUpdate) lines.push(`The update is applied automatically during the night after ${forcedUpdate.deadline}.`);
  if (rollback) lines.push(`cosmoner hosting rollback ${name} returns it to ${buildName(rollback)} (PHP ${rollback.phpVersion}) until ${rollback.until}.`);
  const support = php.securitySupportEnds ? ` Security support for PHP ${php.version} ends ${php.securitySupportEnds}.` : "";
  lines.push(`${php.deprecated ? `PHP ${php.version} is no longer offered and should be upgraded.` : ""}${support} Offered: ${php.offered.join(", ")}.`.trim());
  return lines.join("\n");
}

/** What `hosting mail` prints in text. */
function mailText(name: string, status: HostingMailStatus): string {
  if (!status.available) return `Sites in this environment cannot send email.`;
  if (status.enabled) return `Email is on for site "${name}": PHP mail() sends as ${status.fromAddress}.`;
  const domains = status.domains.map((domain) => domain.name).join(", ");
  return `Email is off for site "${name}": PHP mail() returns false.${domains
    ? ` Turn it on with cosmoner hosting mail ${name} on --from <name>@<domain>, on one of: ${domains}.`
    : " Verify an email domain first: cosmoner email create <domain>."}`;
}

/** Splits `--from wordpress@example.com` into the part before the @ and the domain. */
function splitAddress(address: string): { localPart: string; domain: string } {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) throw new UsageError(`--from must be an address such as wordpress@example.com, not "${address}"`);
  return { localPart: address.slice(0, at), domain: address.slice(at + 1).toLowerCase() };
}

/** `cosmoner hosting image|update|rollback|php|mail`. */
export const HOSTING_SITE_ACTIONS: Record<string, ProductAction<Row>> = {
  image: {
    usage: "image <site>",
    help: `Shows which build of the site image a site runs, the patched build it can
update to and whether that will be applied automatically, what it can roll
back to, and when security support for its PHP version ends. A site never
changes build on its own, except for a fix to a critical or known-exploited
vulnerability, which is applied during the night after its deadline.

Needs hosting:read.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["site"], "hosting image <site>");
      const format = readFormat(args);

      return runWrite(args, env, "hosting:read", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const { data } = await client.hosting.image(row.id as string);
        printResult(format, data, imageText(row.siteName as string, data));
        return 0;
      });
    },
  },

  update: {
    usage: "update <site> [--yes]",
    help: `Moves a site to the newest patched build of its PHP version. The site
restarts onto it, which interrupts it for a few seconds; cosmoner hosting
rollback <site> restores the previous build for 7 days. A site that already
runs the newest build is left alone. Asks first; --yes skips the question.

Needs hosting:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ["yes"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["site"], "hosting update <site>");
      const format = readFormat(args);

      return runWrite(args, env, "hosting:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const name = row.siteName as string;
        const { data: status } = await client.hosting.image(row.id as string);
        if (!status.update) {
          printResult(format, status, `Site "${name}" already runs the newest build, ${buildName(status.current)}.`);
          return 0;
        }
        const summary = `This moves site "${name}" from ${buildName(status.current)} to ${status.update.tag}. ${RESTART_NOTE} cosmoner hosting rollback ${name} restores the current build for 7 days.`;
        const refused = refusal(await confirm(args, summary, `Update site "${name}"?`));
        if (refused !== null) return refused;
        const { data } = await client.hosting.updateImage(row.id as string);
        printResult(format, data, `Site "${name}" runs ${buildName(data.current)}.`);
        return 0;
      });
    },
  },

  rollback: {
    usage: "rollback <site> [--yes]",
    help: `Returns a site to the build it ran before its last update or PHP version
change, PHP version included, for 7 days after that change. The site restarts
onto it. A rollback cannot itself be rolled back; cosmoner hosting update
<site> moves forward again. Rolling back an automatic security update only
postpones it. Asks first; --yes skips the question.

Needs hosting:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ["yes"],
    run: (args, env, resource) => {
      const [ref] = operands(args, ["site"], "hosting rollback <site>");
      const format = readFormat(args);

      return runWrite(args, env, "hosting:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const name = row.siteName as string;
        const { data: status } = await client.hosting.image(row.id as string);
        if (!status.rollback) {
          console.error(`Site "${name}" has nothing to roll back to: it has not changed build in the last 7 days.`);
          return 1;
        }
        const target = status.rollback;
        const summary = `This returns site "${name}" from ${buildName(status.current)} to ${buildName(target)} (PHP ${target.phpVersion}). ${RESTART_NOTE} A rollback cannot itself be rolled back.`;
        const refused = refusal(await confirm(args, summary, `Roll back site "${name}"?`));
        if (refused !== null) return refused;
        const { data } = await client.hosting.rollbackImage(row.id as string);
        printResult(format, data, `Site "${name}" runs ${buildName(data.current)} again.`);
        return 0;
      });
    },
  },

  php: {
    usage: "php <site> <version> [--yes]",
    help: `Moves a site to another PHP version, onto its newest patched build. The
versions offered are listed by cosmoner hosting image <site>. The site
restarts onto it; test it afterwards, since a new PHP version can break an
application. cosmoner hosting rollback <site> restores the previous version
for 7 days. Asks first; --yes skips the question.

Needs hosting:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    switches: ["yes"],
    run: (args, env, resource) => {
      const [ref, phpVersion] = operands(args, ["site", "PHP version"], "hosting php <site> <version>");
      const format = readFormat(args);

      return runWrite(args, env, "hosting:write", async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const name = row.siteName as string;
        const summary = `This moves site "${name}" from PHP ${row.phpVersion} to PHP ${phpVersion}. ${RESTART_NOTE} Test the site afterwards: a new PHP version can break an application. cosmoner hosting rollback ${name} restores PHP ${row.phpVersion} for 7 days.`;
        const refused = refusal(await confirm(args, summary, `Move site "${name}" to PHP ${phpVersion}?`));
        if (refused !== null) return refused;
        const { data } = await client.hosting.setPhpVersion(row.id as string, { phpVersion });
        printResult(format, data, `Site "${name}" runs PHP ${data.php.version}, build ${buildName(data.current)}.`);
        return 0;
      });
    },
  },

  mail: {
    usage: "mail <site> [on --from <address> | off] [--yes]",
    help: `Shows whether a site's PHP mail() can send, and as whom.

cosmoner hosting mail <site> on --from <address>
  Lets the site send as <address>, such as wordpress@example.com, through a
  new SMTP credential on that verified email domain. Every email it sends is
  billed on the project's email plan. Run again with another address to
  replace it. Asks first; --yes skips the question.

cosmoner hosting mail <site> off
  Stops the site sending and deletes its SMTP credential; mail() then returns
  false. Asks first; --yes skips the question.

Reading needs hosting:read; on and off need hosting:write and email:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "from"],
    switches: ["yes"],
    run: (args, env, resource) => {
      const given = args.positional.slice(1);
      const [ref, state] = operands(args, given.length > 1 ? ["site", "on or off"] : ["site"], "hosting mail <site> [on|off]");
      if (state !== undefined && state !== "on" && state !== "off") throw new UsageError(`Say on or off, not "${state}": cosmoner hosting mail <site> on|off`);
      const from = readValue(args, "from");
      if (from !== undefined && state !== "on") throw new UsageError("--from goes with on: cosmoner hosting mail <site> on --from <address>");
      if (state === "on" && from === undefined) throw new UsageError("Pass --from <address>, such as wordpress@example.com");
      const address = from === undefined ? undefined : splitAddress(from);
      const format = readFormat(args);
      const scope = state === undefined ? "hosting:read" : "hosting:write and email:write";

      return runWrite(args, env, scope, async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const name = row.siteName as string;
        const { data: status } = await client.hosting.mail(row.id as string);
        if (state === undefined) {
          printResult(format, status, mailText(name, status));
          return 0;
        }

        if (state === "off") {
          if (!status.enabled) {
            printResult(format, status, `Email is already off for site "${name}".`);
            return 0;
          }
          const summary = `This stops site "${name}" sending email as ${status.fromAddress} and deletes its SMTP credential. Afterwards PHP mail() returns false.`;
          const refused = refusal(await confirm(args, summary, `Turn off email for site "${name}"?`));
          if (refused !== null) return refused;
          const { data } = await client.hosting.disableMail(row.id as string);
          printResult(format, data, `Email is off for site "${name}".`);
          return 0;
        }

        if (!address) return 1;
        if (!status.available) {
          console.error("Sites in this environment cannot send email.");
          return 1;
        }
        const domain = status.domains.find((candidate) => candidate.name.toLowerCase() === address.domain);
        if (!domain) {
          const verified = status.domains.map((candidate) => candidate.name).join(", ");
          console.error(`${address.domain} is not a verified email domain of this project.${verified ? ` Verified: ${verified}.` : " Set one up with cosmoner email create <domain>."}`);
          return 1;
        }
        const replaces = status.enabled ? ` It replaces ${status.fromAddress}.` : "";
        const summary = `This lets site "${name}" send email as ${from}, through a new SMTP credential on ${domain.name}. Every email it sends is billed on the project's email plan.${replaces}`;
        const refused = refusal(await confirm(args, summary, `Turn on email for site "${name}"?`));
        if (refused !== null) return refused;
        const { data } = await client.hosting.enableMail(row.id as string, { emailDomainId: domain.id, localPart: address.localPart });
        printResult(format, data, `Site "${name}" sends email as ${data.fromAddress}.`);
        return 0;
      });
    },
  },
};
