/**
 * `cosmoner hosting domains`: the hostnames a web hosting site answers on.
 *
 * Listing, attaching and changing what one does run straight away: none is
 * billed, and each is undone as easily as it was done. Detaching asks first,
 * like every removal, since the site stops answering on the name at once.
 */

import type { Cosmoner, HostingDomain, HostingDomainAttached, HostingDomainBehaviour } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "../args";
import { renderTable } from "../commands/config-entries";
import { findRow, type ProductAction } from "../read/resource";
import { confirm, refusal } from "./confirm";
import { printResult, readFormat, runWrite, WRITE_VALUE_FLAGS } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.

const USAGE = "hosting domains <site> [attach|change|detach <hostname>]";

/** The folder a domain serves, as an SFTP login sees it. */
function folderOf(domain: HostingDomain, unixUser: string | null): string {
  const root = domain.documentRoot ?? "";
  const home = unixUser ? `/var/www/${unixUser}/` : null;
  return `/${home && root.startsWith(home) ? root.slice(home.length) : root.replace(/^\/+/, "")}`;
}

/** What a domain does, in a few words. */
function behaviourText(domain: HostingDomain, unixUser: string | null): string {
  if (domain.kind === "REDIRECT") return `redirects to ${domain.redirectTarget} (${domain.redirectStatus ?? 301})`;
  if (domain.kind === "PARKED") return "parked";
  return `serves ${folderOf(domain, unixUser)}`;
}

/** Whether the hostname answers yet. */
function routingText(domain: HostingDomain): string {
  if (domain.routingStatus === "ACTIVE") return "live";
  if (domain.routingStatus === "VERIFYING") return "waiting for DNS";
  return domain.routingStatus.toLowerCase();
}

/**
 * The behaviour the flags ask for, or null when none was given. At most one
 * of --website, --path, --redirect and --parked; --temporary only with
 * --redirect.
 */
function behaviourFrom(args: ParsedArgs): HostingDomainBehaviour | null {
  const path = readValue(args, "path");
  const redirect = readValue(args, "redirect");
  const parked = args.flags.get("parked") === true;
  const website = args.flags.get("website") === true;
  const temporary = args.flags.get("temporary") === true;

  const given = [website && "--website", path !== undefined && "--path", redirect !== undefined && "--redirect", parked && "--parked"].filter(Boolean);
  if (given.length > 1) throw new UsageError(`Pass one of --website, --path, --redirect and --parked, not ${given.join(" and ")}`);
  if (temporary && redirect === undefined) throw new UsageError("--temporary goes with --redirect <url>");

  if (redirect !== undefined) return { kind: "REDIRECT", redirectTarget: redirect, redirectStatus: temporary ? 302 : 301 };
  if (parked) return { kind: "PARKED" };
  if (path !== undefined) return { kind: "SITE", path: path.replace(/^\/+/, "") };
  if (website) return { kind: "SITE" };
  return null;
}

/** What an attach prints: the hostname, and the DNS records either added or to add. */
function attachedText(result: HostingDomainAttached): string {
  const { instructions: dns } = result;
  const records = [
    ["TYPE", "NAME", "VALUE"],
    [dns.recordType, dns.name, dns.value],
    ...(dns.ownershipVerification ? [[dns.ownershipVerification.type.toUpperCase(), dns.ownershipVerification.name, dns.ownershipVerification.value]] : []),
  ];
  const [headers, ...rows] = records;
  return [
    result.dnsRecordsCreated
      ? `Attached ${result.hostname}. Cosmoner runs its DNS, so these records were added for you; it goes live once its certificate is issued, usually within minutes.`
      : `Attached ${result.hostname}. Add these records at your DNS provider; it goes live once they are in place.`,
    "",
    renderTable(headers, rows),
  ].join("\n");
}

/** The attached domain named `hostname`, or null after saying which ones the site has. */
async function findDomain(client: Cosmoner, siteId: string, siteName: string, hostname: string): Promise<HostingDomain | null> {
  const { data: domains } = await client.hosting.domains(siteId);
  const domain = domains.find((candidate) => candidate.hostname === hostname.toLowerCase());
  if (domain) return domain;
  const attached = domains.map((candidate) => candidate.hostname).join(", ");
  console.error(`${hostname} is not attached to site "${siteName}".${attached ? ` It has: ${attached}.` : " It has no domains."}`);
  return null;
}

/** `cosmoner hosting domains`. */
export const HOSTING_DOMAIN_ACTIONS: Record<string, ProductAction<Row>> = {
  domains: {
    usage: "domains <site> [attach|change|detach <hostname>]",
    help: `Lists the domains a web hosting site answers on, what each does, and
whether it is live yet.

cosmoner hosting domains <site> attach <hostname>
  Points one of the project's verified domains, or a subdomain of one, at the
  site. Add the domain to the project first: cosmoner domains create. By
  default it is a website served from its own folder, <hostname>/public_html,
  which is created. When Cosmoner runs the domain's DNS the records are added
  for you; otherwise the command prints the ones to add.
    --path <folder>     Serve a folder already on the site instead.
    --redirect <url>    Send visitors to <url>, keeping the path; 301, or
                        302 with --temporary.
    --parked            Show a placeholder page.

cosmoner hosting domains <site> change <hostname>
  Changes what an attached domain does: --website (its default folder),
  --path <folder>, --redirect <url> [--temporary] or --parked. Its DNS
  records and certificate are untouched.

cosmoner hosting domains <site> detach <hostname>
  Stops the site answering on the domain. A folder it served stays, with its
  files. Asks first; --yes skips the question.

Listing needs hosting:read; attach, change and detach need hosting:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "path", "redirect"],
    switches: ["yes", "website", "parked", "temporary"],
    run: (args, env, resource) => {
      const given = args.positional.slice(1);
      const [ref, verb, hostname, extra] = given;
      if (ref === undefined) throw new UsageError(`Name the site: cosmoner ${USAGE}`);
      if (verb !== undefined && verb !== "attach" && verb !== "change" && verb !== "detach") {
        throw new UsageError(`Say attach, change or detach, not "${verb}": cosmoner ${USAGE}`);
      }
      if (verb !== undefined && hostname === undefined) throw new UsageError(`Name the hostname: cosmoner hosting domains <site> ${verb} <hostname>`);
      if (extra !== undefined) throw new UsageError(`Unexpected argument "${extra}"`);

      const behaviour = behaviourFrom(args);
      if (verb === undefined || verb === "detach") {
        if (behaviour !== null) throw new UsageError(`--website, --path, --redirect and --parked go with attach or change`);
      }
      if (verb === "change" && behaviour === null) {
        throw new UsageError("Say what it should do: --website, --path <folder>, --redirect <url> or --parked");
      }
      const format = readFormat(args);
      const scope = verb === undefined ? "hosting:read" : "hosting:write";

      return runWrite(args, env, scope, async (client) => {
        const row = await findRow(resource, client, ref);
        if (!row) return 1;
        const siteId = row.id as string;
        const name = row.siteName as string;
        const unixUser = (row.unixUser as string | null) ?? null;

        if (verb === undefined) {
          const { data: domains } = await client.hosting.domains(siteId);
          const text = domains.length
            ? renderTable(
                ["HOSTNAME", "DOES", "STATUS"],
                domains.map((domain) => [domain.hostname, behaviourText(domain, unixUser), routingText(domain)])
              )
            : `Site "${name}" has no domains. Attach one with cosmoner hosting domains ${name} attach <hostname>.`;
          printResult(format, domains, text);
          return 0;
        }

        if (verb === "attach") {
          const { data } = await client.hosting.attachDomain(siteId, { hostname: hostname as string, ...behaviour });
          printResult(format, data, attachedText(data));
          return 0;
        }

        const domain = await findDomain(client, siteId, name, hostname as string);
        if (!domain) return 1;

        if (verb === "change") {
          await client.hosting.updateDomain(siteId, domain.id, behaviour ?? {});
          const { data: after } = await client.hosting.domains(siteId);
          const changed = after.find((candidate) => candidate.id === domain.id) ?? domain;
          printResult(format, changed, `${domain.hostname} now ${behaviourText(changed, unixUser)}.`);
          return 0;
        }

        const summary = `This stops site "${name}" answering on ${domain.hostname}, which now ${behaviourText(domain, unixUser)}. Its files stay where they are.`;
        const refused = refusal(await confirm(args, summary, `Detach ${domain.hostname} from site "${name}"?`));
        if (refused !== null) return refused;
        await client.hosting.detachDomain(siteId, domain.id);
        printResult(format, { id: domain.id, hostname: domain.hostname, detached: true }, `Detached ${domain.hostname} from site "${name}".`);
        return 0;
      });
    },
  },
};
