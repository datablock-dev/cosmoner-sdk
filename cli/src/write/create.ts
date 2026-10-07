/**
 * Ordering paid resources, and the catalogue commands that say what can be
 * ordered.
 *
 * Every `create` here, and `apps resize`, prices the order with the API's
 * preview, shows the price, and asks before buying (order.ts, confirm.ts):
 * `--yes` answers for scripts, and without a terminal and without `--yes` the
 * command exits 2 having bought nothing.
 *
 * Servers, Redis and databases come back from the API without an id, so the
 * new resource is found again by name. A name already in use is refused before
 * ordering, which keeps that lookup unambiguous.
 */

import type { Cosmoner } from "@cosmoner/sdk";

import { readValue, UsageError, type ParsedArgs } from "../args";
import { renderTable } from "../commands/config-entries";
import { redact } from "../read/redact";
import { findRow, type ProductAction, type ReadableResource } from "../read/resource";
import { confirm, refusal } from "./confirm";
import { approveOrder, changeText, money, pickRegion, pickSlug, priceText } from "./order";
import { operands, readFormat, runWrite, WRITE_VALUE_FLAGS, type WriteFormat } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.
type Product = ReadableResource<Row>;

const ORDER_SWITCHES = ["yes"] as const;
const ORDER_NOTE = `Shows the price and asks before ordering; --yes skips the question. Without
a terminal and without --yes it orders nothing and exits 2. The order is
charged to the project's saved card at once.`;

// ─── Shared steps ───────────────────────────────────────────────────────────

/** Refuses a name some existing item already has, so the new one can be found by it. */
async function assertNameFree(client: Cosmoner, product: Product, name: string): Promise<void> {
  const taken = (await product.list(client)).some((row) => product.matches(row, name));
  if (taken) throw new UsageError(`A ${product.noun} named "${name}" already exists in this project`);
}

/** Prints what was ordered: a sentence, or `{ created, price }` as JSON. */
function printOrdered(format: WriteFormat, created: unknown, price: unknown, text: string): void {
  if (format === "json") console.log(JSON.stringify({ created: redact(created), price }, null, 2));
  else console.log(text);
}

/** Prints a catalogue: a table, or the API's array as JSON. */
function printCatalog(format: WriteFormat, rows: Row[], headers: string[], cells: (row: Row) => unknown[]): void {
  if (format === "json") {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log(renderTable(headers, rows.map((row) => cells(row).map((cell) => (cell === null || cell === undefined || cell === "" ? "-" : String(cell))))));
}

/** A catalogue verb: no operands, no write, only `--format`. */
function catalogAction(usage: string, help: string, run: (client: Cosmoner, format: WriteFormat) => Promise<void>): ProductAction<Row> {
  return {
    usage,
    help: `${help}\n\nAny credential can read it.`,
    valueFlags: [...WRITE_VALUE_FLAGS],
    run: (args, env) => {
      operands(args, [], usage);
      const format = readFormat(args);
      return runWrite(args, env, "any scope", async (client) => {
        await run(client, format);
        return 0;
      });
    },
  };
}

/** Memory in MB as "1 GB" or "512 MB". */
function memory(mb: unknown): string {
  const value = Number(mb);
  if (!Number.isFinite(value)) return "-";
  return value >= 1024 ? `${value / 1024} GB` : `${value} MB`;
}

/** Whole dollars as "$12/mo". */
function dollars(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount}/mo` : "-";
}

/** A flag that must be one of `choices`, compared case-insensitively, returned as the API spells it. */
function readEnum(args: ParsedArgs, flag: string, choices: readonly string[]): string | undefined {
  const value = readValue(args, flag);
  if (value === undefined) return undefined;
  const normalised = value.toUpperCase().replaceAll("-", "_");
  const match = choices.find((choice) => choice === normalised);
  if (!match) throw new UsageError(`--${flag} must be one of ${choices.map((choice) => choice.toLowerCase().replaceAll("_", "-")).join(", ")}`);
  return match;
}

// ─── Servers ────────────────────────────────────────────────────────────────

export const SERVER_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --size <size> --region <region> [--image <image>] [--ssh-keys <key,…>] [--yes]",
    help: `Orders a server. cosmoner servers sizes, regions and images list the
choices. --ssh-keys names project SSH keys by name, id or fingerprint.

${ORDER_NOTE}

Needs servers:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "size", "region", "image", "ssh-keys"],
    switches: ORDER_SWITCHES,
    run: (args, env, servers) => {
      const [name] = operands(args, ["server name"], "servers create <name> --size <size> --region <region>");
      const format = readFormat(args);
      const keyRefs = readValue(args, "ssh-keys")?.split(",").map((ref) => ref.trim()).filter(Boolean);

      return runWrite(args, env, "servers:write", async (client) => {
        const [{ data: sizes }, { data: regions }] = await Promise.all([client.catalog.serverSizes(), client.catalog.serverRegions()]);
        const size = pickSlug(readValue(args, "size"), sizes.map((entry) => entry.slug), "size", "cosmoner servers sizes");
        const region = pickRegion(readValue(args, "region"), regions.map((entry) => entry.slug), "A server");
        await assertNameFree(client, servers, name);

        let sshKeyIds: string[] | undefined;
        if (keyRefs) {
          const { data: keys } = await client.sshKeys.list();
          sshKeyIds = keyRefs.map((ref) => {
            const key = keys.find((candidate) => [candidate.id, candidate.name, candidate.fingerprint].includes(ref));
            if (!key) throw new UsageError(`No ssh-key "${ref}" in this project`);
            return key.id;
          });
        }

        const { data: quote } = await client.servers.preview({ size });
        const refused = await approveOrder(args, `server "${name}": ${size} in ${region}`, priceText(quote), `Order server "${name}"?`);
        if (refused !== null) return refused;

        await client.servers.create({ name, size, region, image: readValue(args, "image"), sshKeyIds });
        const created = await findRow(servers, client, name);
        printOrdered(format, created, quote, `Ordered server "${name}". It is provisioning; cosmoner servers get ${name} shows when it is running.`);
        return 0;
      });
    },
  },

  sizes: catalogAction("sizes", "Lists server sizes and their monthly prices.", async (client, format) => {
    const { data } = await client.catalog.serverSizes();
    printCatalog(format, data as Row[], ["SIZE", "VCPUS", "MEMORY", "DISK", "TRANSFER", "PRICE"], (row) => [
      row.slug,
      row.vcpus,
      memory(row.memoryMb),
      `${row.diskGb} GB`,
      `${row.transferTb} TB`,
      dollars(row.priceMonthly),
    ]);
  }),

  regions: catalogAction("regions", "Lists the regions servers can be created in.", async (client, format) => {
    const { data } = await client.catalog.serverRegions();
    printCatalog(format, data as Row[], ["REGION", "NAME"], (row) => [row.slug, row.name]);
  }),

  images: catalogAction("images", "Lists the one-click images a server can start from.", async (client, format) => {
    const { data } = await client.catalog.serverImages();
    printCatalog(format, data as Row[], ["IMAGE", "TYPE"], (row) => [row.slug, row.type]);
  }),
};

// ─── Redis ──────────────────────────────────────────────────────────────────

const PERSISTENCE = [
  "NONE",
  "AOF_EVERY_WRITE",
  "AOF_EVERY_1_SECOND",
  "SNAPSHOT_EVERY_1_HOUR",
  "SNAPSHOT_EVERY_6_HOURS",
  "SNAPSHOT_EVERY_12_HOURS",
] as const;

export const REDIS_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --plan <plan> [--region <region>] [--persistence <mode>] [--yes]",
    help: `Orders a Redis database. cosmoner redis plans lists the plans. --region
defaults to the only region there is. --persistence is none (the default),
aof-every-write, aof-every-1-second, snapshot-every-1-hour,
snapshot-every-6-hours or snapshot-every-12-hours.

${ORDER_NOTE}

Needs redis:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "plan", "region", "persistence"],
    switches: ORDER_SWITCHES,
    run: (args, env, redis) => {
      const [name] = operands(args, ["Redis name"], "redis create <name> --plan <plan>");
      const persistence = readEnum(args, "persistence", PERSISTENCE) as (typeof PERSISTENCE)[number] | undefined;
      const format = readFormat(args);

      return runWrite(args, env, "redis:write", async (client) => {
        const [{ data: plans }, { data: regions }] = await Promise.all([client.catalog.redisPlans(), client.catalog.redisRegions()]);
        const plan = pickSlug(readValue(args, "plan"), plans.map((entry) => entry.slug), "plan", "cosmoner redis plans");
        const region = pickRegion(readValue(args, "region"), regions.map((entry) => entry.slug), "Redis");
        await assertNameFree(client, redis, name);

        const { data: quote } = await client.redis.preview({ plan });
        const refused = await approveOrder(args, `Redis "${name}": plan ${plan} in ${region}`, priceText(quote), `Order Redis "${name}"?`);
        if (refused !== null) return refused;

        await client.redis.create({ name, plan, region, persistence });
        const created = await findRow(redis, client, name);
        printOrdered(format, created, quote, `Ordered Redis "${name}". It is starting; cosmoner redis get ${name} shows when it is active.`);
        return 0;
      });
    },
  },

  plans: catalogAction("plans", "Lists Redis plans and their monthly prices.", async (client, format) => {
    const { data } = await client.catalog.redisPlans();
    printCatalog(format, data as Row[], ["PLAN", "MEMORY", "PERSISTENCE", "PRICE"], (row) => [
      row.slug,
      memory(row.memoryMb),
      row.supportsPersistence ? "yes" : "no",
      dollars(row.priceMonthly),
    ]);
  }),

  regions: catalogAction("regions", "Lists the regions Redis can be created in.", async (client, format) => {
    const { data } = await client.catalog.redisRegions();
    printCatalog(format, data as Row[], ["REGION", "NAME"], (row) => [row.slug, row.name]);
  }),
};

// ─── Databases ──────────────────────────────────────────────────────────────

export const DATABASE_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --size <size> [--version <version>] [--region <region>] [--yes]",
    help: `Orders a dedicated PostgreSQL database. cosmoner databases sizes lists the
sizes, versions and regions. --version defaults to the newest, --region to the
only region there is.

${ORDER_NOTE}

Needs databases:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "size", "version", "region"],
    switches: ORDER_SWITCHES,
    run: (args, env, databases) => {
      const [name] = operands(args, ["database name"], "databases create <name> --size <size>");
      const format = readFormat(args);

      return runWrite(args, env, "databases:write", async (client) => {
        const { data: catalog } = await client.catalog.databases();
        const size = pickSlug(readValue(args, "size"), catalog.sizes.map((entry) => entry.slug), "size", "cosmoner databases sizes");
        const region = pickRegion(readValue(args, "region"), catalog.regions.map((entry) => entry.slug), "A database");
        const versions = catalog.engines.find((entry) => entry.engine === "POSTGRESQL")?.versions ?? [];
        const version = readValue(args, "version") ?? versions[0];
        if (version === undefined || (versions.length > 0 && !versions.includes(version))) {
          throw new UsageError(`Pass --version. Versions: ${versions.join(", ")}`);
        }
        await assertNameFree(client, databases, name);

        const { data: quote } = await client.databases.previewDedicated({ size });
        const what = `database "${name}": PostgreSQL ${version}, ${size} in ${region}`;
        const refused = await approveOrder(args, what, priceText(quote), `Order database "${name}"?`);
        if (refused !== null) return refused;

        await client.databases.createDedicated({ name, size, version, region });
        const created = await findRow(databases, client, name);
        printOrdered(format, created, quote, `Ordered database "${name}". It is starting; cosmoner databases get ${name} shows when it is online.`);
        return 0;
      });
    },
  },

  sizes: catalogAction("sizes", "Lists dedicated database sizes and prices, then the versions and regions.", async (client, format) => {
    const { data } = await client.catalog.databases();
    if (format === "json") {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    printCatalog(format, data.sizes as Row[], ["SIZE", "VCPUS", "MEMORY", "DISK", "PRICE"], (row) => [
      row.slug,
      row.vcpus,
      memory(row.memoryMb),
      `${row.diskGb} GB`,
      dollars(row.priceMonthly),
    ]);
    for (const engine of data.engines) console.log(`\n${engine.engine} versions: ${engine.versions.join(", ")}`);
    console.log(`Regions: ${data.regions.map((region) => region.slug).join(", ")}`);
  }),
};

// ─── Buckets ────────────────────────────────────────────────────────────────

const TIERS = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;

export const BUCKET_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --region <aws-region> [--tier <tier>] [--public] [--versioning] [--cdn] [--yes]",
    help: `Orders a bucket. --region is an AWS region such as eu-north-1. --tier is one of
starter (25 GB), growth (100 GB), scale (500 GB) or enterprise (2 TB); starter
by default. --cdn needs --public, and its traffic is metered on top of the tier.

${ORDER_NOTE}

Needs object-storage:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "region", "tier"],
    switches: [...ORDER_SWITCHES, "public", "versioning", "cdn"],
    run: (args, env, buckets) => {
      const [name] = operands(args, ["bucket name"], "buckets create <name> --region <aws-region>");
      const region = readValue(args, "region");
      if (region === undefined) throw new UsageError("Pass --region, an AWS region such as eu-north-1");
      const tier = (readEnum(args, "tier", TIERS) ?? "STARTER") as (typeof TIERS)[number];
      const publicAccess = args.flags.get("public") === true;
      const cdnEnabled = args.flags.get("cdn") === true;
      if (cdnEnabled && !publicAccess) throw new UsageError("--cdn needs --public");
      const format = readFormat(args);

      return runWrite(args, env, "object-storage:write", async (client) => {
        const { data: quote } = await client.buckets.preview({ tier });
        const extra = cdnEnabled ? " CDN traffic is billed on top, by use." : "";
        const refused = await approveOrder(args, `bucket "${name}": ${tier.toLowerCase()} tier in ${region}`, priceText(quote) + extra, `Order bucket "${name}"?`);
        if (refused !== null) return refused;

        await client.buckets.create({ name, region, tier, publicAccess, versioning: args.flags.get("versioning") === true, cdnEnabled });
        const created = await findRow(buckets, client, name);
        printOrdered(format, created, quote, `Ordered bucket "${name}". It is ready.`);
        return 0;
      });
    },
  },
};

// ─── Registries ─────────────────────────────────────────────────────────────

export const REGISTRY_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --region <region> [--provider <provider>] [--yes]",
    help: `Orders a container registry. cosmoner registries providers lists the providers
and their regions. Storage and egress are billed on top of the base fee, by
use.

${ORDER_NOTE}

Needs registry:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "region", "provider"],
    switches: ORDER_SWITCHES,
    run: (args, env, registries) => {
      const [name] = operands(args, ["registry name"], "registries create <name> --region <region>");
      const format = readFormat(args);

      return runWrite(args, env, "registry:write", async (client) => {
        const { data: providers } = await client.registries.providers();
        const wanted = readValue(args, "provider")?.toUpperCase();
        const provider = wanted === undefined ? (providers.length === 1 ? providers[0] : providers.find((entry) => entry.value === "AWS_ECR")) : providers.find((entry) => entry.value === wanted);
        if (!provider) throw new UsageError(`Pass --provider. Providers: ${providers.map((entry) => entry.value).join(", ")}`);
        const region = pickRegion(readValue(args, "region"), provider.regions.map((entry) => entry.value), "A registry");

        const { data: quote } = await client.registries.preview();
        const what = `registry "${name}": ${provider.label} in ${region}`;
        const refused = await approveOrder(args, what, `${priceText(quote)} Storage and egress are billed on top, by use.`, `Order registry "${name}"?`);
        if (refused !== null) return refused;

        await client.registries.create({ name, region, provider: provider.value });
        const created = await findRow(registries, client, name);
        printOrdered(format, created, quote, `Ordered registry "${name}". It is ready.`);
        return 0;
      });
    },
  },

  providers: catalogAction("providers", "Lists registry providers and the regions each offers.", async (client, format) => {
    const { data } = await client.registries.providers();
    printCatalog(format, data as Row[], ["PROVIDER", "NAME", "REGIONS"], (row) => [
      row.value,
      row.label,
      (row.regions as Row[]).map((region) => region.value).join(", "),
    ]);
  }),
};

// ─── Hosting ────────────────────────────────────────────────────────────────

const HOSTING_TIERS = ["STARTER", "GROWTH", "SCALE"] as const;

export const HOSTING_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <site> [--tier <tier>] [--php <version>] [--database <name>] [--extra-storage <gb>] [--yes]",
    help: `Orders a PHP hosting site. <site> is 3–40 lowercase letters, digits and
underscores, starting with a letter. --tier is starter, growth or scale
(starter by default; cosmoner hosting plans lists the prices). --php is 8.1,
8.2 or 8.3. --database creates a MySQL database alongside it.
--extra-storage adds storage in 10 GB blocks, up to 50.

${ORDER_NOTE}

Needs hosting:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "tier", "php", "database", "extra-storage"],
    switches: ORDER_SWITCHES,
    run: (args, env) => {
      const [siteName] = operands(args, ["site name"], "hosting create <site>");
      const tier = (readEnum(args, "tier", HOSTING_TIERS) ?? "STARTER") as (typeof HOSTING_TIERS)[number];
      const extra = readValue(args, "extra-storage");
      if (extra !== undefined && !/^(0|10|20|30|40|50)$/.test(extra)) throw new UsageError("--extra-storage must be 0, 10, 20, 30, 40 or 50");
      const extraStorageGb = extra === undefined ? undefined : Number(extra);
      const format = readFormat(args);

      return runWrite(args, env, "hosting:write", async (client) => {
        const { data: quote } = await client.hosting.preview({ tier, extraStorageGb });
        const storage = extraStorageGb ? ` with ${extraStorageGb} GB extra storage` : "";
        const refused = await approveOrder(args, `hosting site "${siteName}": ${tier.toLowerCase()} tier${storage}`, priceText(quote), `Order site "${siteName}"?`);
        if (refused !== null) return refused;

        const { data } = await client.hosting.create({
          siteName,
          tier,
          phpVersion: readValue(args, "php"),
          database: readValue(args, "database"),
          extraStorageGb,
        });
        printOrdered(format, data, quote, `Ordered hosting site "${siteName}". cosmoner hosting get ${siteName} shows when it is serving.`);
        if (data.databaseError) console.error(`The site was created, but its database was not: ${data.databaseError}`);
        return 0;
      });
    },
  },

  plans: catalogAction("plans", "Lists hosting plans and their monthly prices.", async (client, format) => {
    const { data } = await client.hosting.prices();
    printCatalog(format, data as Row[], ["TIER", "PRICE"], (row) => [String(row.tier).toLowerCase(), `${money(row.monthly, String(row.currency).toUpperCase())}/mo`]);
  }),
};

// ─── Apps ───────────────────────────────────────────────────────────────────

/** Which registry an image reference pulls from, as the API names it. */
function registryOf(image: string): "ghcr" | "cosmoner" | "dockerhub" {
  const host = image.split("/")[0];
  if (host === "ghcr.io") return "ghcr";
  if (host.endsWith("cosmoner.com")) return "cosmoner";
  return "dockerhub";
}

/** A port flag as a positive whole number. */
function port(args: ParsedArgs, flag: string): number | undefined {
  const value = readValue(args, flag);
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new UsageError(`--${flag} must be a port number`);
  return Number(value);
}

export const APP_ORDER_ACTIONS: Record<string, ProductAction<Row>> = {
  create: {
    usage: "create <name> --size <size> (--image <image> | --repo <owner/repo>) [options] [--yes]",
    help: `Creates and deploys an app on a Cosmoner subdomain. cosmoner apps sizes and
apps regions list the choices; --region defaults to the only region there is.

From an image, public or in a Cosmoner registry:
  --image <image>          e.g. ghcr.io/acme/web:v1 or nginx:1.27
  --port <port>            The port the image listens on.

From a repository connected to the project:
  --repo <owner/repo>      --git-provider github|gitlab|bitbucket (github)
  --branch <branch>        --dir <path>     --static
  --build-command <cmd>    --run-command <cmd>    --port <port>

${ORDER_NOTE}

Needs apps:write.`,
    valueFlags: [
      ...WRITE_VALUE_FLAGS,
      "size",
      "region",
      "image",
      "repo",
      "git-provider",
      "branch",
      "dir",
      "build-command",
      "run-command",
      "port",
    ],
    switches: [...ORDER_SWITCHES, "static"],
    run: (args, env) => {
      const [name] = operands(args, ["app name"], "apps create <name> --size <size> --image <image>");
      const image = readValue(args, "image");
      const repo = readValue(args, "repo");
      if ((image === undefined) === (repo === undefined)) throw new UsageError("Pass --image or --repo, one of them");
      if (repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(repo)) throw new UsageError("--repo must be owner/repo");
      const gitProvider = readValue(args, "git-provider") ?? "github";
      if (!["github", "gitlab", "bitbucket"].includes(gitProvider)) throw new UsageError("--git-provider must be github, gitlab or bitbucket");
      const listen = port(args, "port");
      const format = readFormat(args);

      return runWrite(args, env, "apps:write", async (client) => {
        const [{ data: sizes }, { data: regions }] = await Promise.all([client.catalog.appSizes(), client.catalog.appRegions()]);
        const size = pickSlug(readValue(args, "size"), sizes.map((entry) => entry.slug), "size", "cosmoner apps sizes");
        const region = pickRegion(readValue(args, "region"), (regions as Row[]).map((entry) => String(entry.slug)), "An app");

        const source = image !== undefined
          ? { containerRegistry: registryOf(image), containerImage: image, containerPublicPort: listen === undefined ? undefined : String(listen) }
          : {
              gitProvider: gitProvider as "github" | "gitlab" | "bitbucket",
              gitRepo: repo,
              gitBranch: readValue(args, "branch"),
              sourceDir: readValue(args, "dir"),
              appType: args.flags.get("static") === true ? ("static" as const) : ("service" as const),
              buildCommand: readValue(args, "build-command"),
              runCommand: readValue(args, "run-command"),
              publicPort: listen,
            };

        const { data: quote } = await client.apps.preview({ size });
        const from = image ?? `${repo}${readValue(args, "branch") ? `@${readValue(args, "branch")}` : ""}`;
        const refused = await approveOrder(args, `app "${name}": ${size} in ${region}, from ${from}`, priceText(quote), `Create app "${name}"?`);
        if (refused !== null) return refused;

        const { data: draft } = await client.apps.createDraft({ name, size, region, ...source });
        const { data } = await client.apps.create({ draftId: draft.draftId, size });
        const { data: app } = await client.apps.get(data.appId);
        printOrdered(format, app, quote, `Created app "${name}". It is deploying; cosmoner apps get ${name} shows its status and URL.`);
        return 0;
      });
    },
  },

  resize: {
    usage: "resize <app> --size <size> [--yes]",
    help: `Moves an app to another size. The difference is charged, or credited, at
once. Shows the price change and asks first; --yes skips the question.
cosmoner apps sizes lists the sizes.

Needs apps:write.`,
    valueFlags: [...WRITE_VALUE_FLAGS, "size"],
    switches: ORDER_SWITCHES,
    run: (args, env, apps) => {
      const [ref] = operands(args, ["app"], "apps resize <app> --size <size>");
      const wanted = readValue(args, "size");
      if (wanted === undefined) throw new UsageError("Pass --size. cosmoner apps sizes lists them");
      const format = readFormat(args);

      return runWrite(args, env, "apps:write", async (client) => {
        const row = await findRow(apps, client, ref);
        if (!row) return 1;
        const { data: options } = await client.apps.sizes(row.id as string);
        if (!options.resizable) throw new UsageError(`App "${ref}" cannot be resized`);
        if (wanted === options.currentSize) throw new UsageError(`App "${ref}" is already ${wanted}`);
        pickSlug(wanted, options.sizes.map((entry) => entry.slug), "size", `cosmoner apps sizes`);

        const { data: quote } = await client.apps.resizePreview(row.id as string, { size: wanted });
        const summary = `This resizes app "${ref}" from ${options.currentSize} to ${wanted}.\n${changeText(quote)}`;
        const refused = refusal(await confirm(args, summary, `Resize app "${ref}"?`));
        if (refused !== null) return refused;

        const { data } = await client.apps.resize(row.id as string, { size: wanted });
        printOrdered(format, data, quote, `Resized app "${ref}" to ${data.instanceSize}.`);
        return 0;
      });
    },
  },

  sizes: catalogAction("sizes", "Lists app sizes and their monthly prices.", async (client, format) => {
    const { data } = await client.catalog.appSizes();
    printCatalog(format, data as Row[], ["SIZE", "CPUS", "MEMORY", "PRICE"], (row) => [
      row.slug,
      `${row.cpus} ${row.cpu_type}`.trim(),
      memory(Number(row.memory_bytes) / 1024 / 1024),
      dollars(row.usd_per_month),
    ]);
  }),

  regions: catalogAction("regions", "Lists the regions apps can be created in.", async (client, format) => {
    const { data } = await client.catalog.appRegions();
    printCatalog(format, data as Row[], ["REGION", "NAME"], (row) => [row.slug, row.label ?? row.name]);
  }),
};
