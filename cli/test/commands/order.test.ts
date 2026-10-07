import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { askYesNo, stdinIsTty } from "../../src/stdin";
import { money } from "../../src/write/order";

/**
 * Drives the paid `create` commands, `apps resize` and the catalogue commands
 * through the real entry point against a mocked API.
 *
 * The property everything here protects: nothing is ordered until the price
 * has been shown and the order confirmed — in a terminal by answering yes, in
 * a script by passing --yes — and a script that did neither buys nothing.
 */

vi.mock("../../src/stdin", async (importOriginal) => ({
  ...(await importOriginal<typeof Stdin>()),
  stdinIsTty: vi.fn(),
  askYesNo: vi.fn(),
}));

const BASE = "https://api.test.dev";
const P = `${BASE}/v1/projects/proj-1`;
const ENV = { COSMONER_API_KEY: "db_key", COSMONER_PROJECT_ID: "proj-1", COSMONER_API_URL: BASE };

const QUOTE = { subtotal: 1200, tax: null, creditApplied: 0, dueToday: 450, monthly: 1200, currency: "USD", nextBillingDate: "2026-10-25T00:00:00.000Z" };

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** A JSON response with the API's success envelope. */
function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Answers requests by "METHOD url". A value that is an array answers
 * successive calls in turn, so a listing can be empty before an order and
 * hold the new item after it.
 */
function routes(table: Record<string, unknown>): void {
  const calls = new Map<string, number>();
  fetchSpy.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    if (!(key in table)) throw new Error(`Unexpected request ${key}`);
    const answer = table[key];
    const index = calls.get(key) ?? 0;
    calls.set(key, index + 1);
    const data = answer instanceof Sequence ? answer.items[Math.min(index, answer.items.length - 1)] : answer;
    return Promise.resolve(reply(data));
  });
}

/** Successive answers for one route. */
class Sequence {
  constructor(readonly items: unknown[]) {}
}

/** Every request sent, as "METHOD url". */
function requested(): string[] {
  return (fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>).map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`);
}

/** The JSON body of the request sent as "METHOD url". */
function bodyOf(key: string): unknown {
  const call = (fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>).find(([url, init]) => `${init?.method ?? "GET"} ${String(url)}` === key);
  if (!call) throw new Error(`No request ${key}`);
  return JSON.parse(String(call[1]?.body));
}

/** Runs one command line. */
async function cli(argv: string[]) {
  const code = await run(argv, "/", false, ENV);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
  vi.mocked(stdinIsTty).mockReturnValue(true);
  vi.mocked(askYesNo).mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(stdinIsTty).mockReset();
  vi.mocked(askYesNo).mockReset();
});

const REDIS_CATALOG = {
  [`GET ${BASE}/v1/catalog/redis/plans`]: [{ slug: "valkey-1gb", memoryMb: 1024, supportsPersistence: true, priceMonthly: 12 }],
  [`GET ${BASE}/v1/catalog/redis/regions`]: [{ slug: "se-sto", name: "Stockholm" }],
};

describe("paid creates", () => {
  it("shows the price, asks, orders, and finds the new item by name", async () => {
    routes({
      ...REDIS_CATALOG,
      [`GET ${P}/redis`]: new Sequence([[], [{ id: "r-1", name: "cache", status: "CREATING" }]]),
      [`GET ${P}/redis/preview?planSlug=valkey-1gb`]: QUOTE,
      [`POST ${P}/redis`]: { deployed: true },
    });

    const result = await cli(["redis", "create", "cache", "--plan", "valkey-1gb", "--persistence", "aof-every-1-second"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('This orders Redis "cache": plan valkey-1gb in se-sto.');
    expect(result.stderr).toContain("It costs $12.00 a month before tax");
    expect(result.stderr).toContain("About $4.50 is charged now, prorated until 25 Oct 2026.");
    expect(askYesNo).toHaveBeenCalledWith('Order Redis "cache"?');
    expect(bodyOf(`POST ${P}/redis`)).toEqual({ name: "cache", planSlug: "valkey-1gb", region: "se-sto", dataPersistence: "AOF_EVERY_1_SECOND" });
    expect(result.stdout).toContain('Ordered Redis "cache"');
  });

  it("orders nothing when the answer is no", async () => {
    vi.mocked(askYesNo).mockResolvedValue(false);
    routes({ ...REDIS_CATALOG, [`GET ${P}/redis`]: [], [`GET ${P}/redis/preview?planSlug=valkey-1gb`]: QUOTE });

    const result = await cli(["redis", "create", "cache", "--plan", "valkey-1gb"]);

    expect(result.code).toBe(1);
    expect(requested().some((key) => key.startsWith("POST"))).toBe(false);
  });

  it("orders nothing without a terminal and without --yes, exiting 2 with the price", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({ ...REDIS_CATALOG, [`GET ${P}/redis`]: [], [`GET ${P}/redis/preview?planSlug=valkey-1gb`]: QUOTE });

    const result = await cli(["redis", "create", "cache", "--plan", "valkey-1gb"]);

    expect(result.code).toBe(2);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(result.stderr).toContain("$12.00 a month");
    expect(result.stderr).toContain("Rerun with --yes");
    expect(requested().some((key) => key.startsWith("POST"))).toBe(false);
  });

  it("orders with --yes without asking, printing the item and the price as JSON", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({
      ...REDIS_CATALOG,
      [`GET ${P}/redis`]: new Sequence([[], [{ id: "r-1", name: "cache", status: "CREATING" }]]),
      [`GET ${P}/redis/preview?planSlug=valkey-1gb`]: QUOTE,
      [`POST ${P}/redis`]: { deployed: true },
    });

    const result = await cli(["redis", "create", "cache", "--plan", "valkey-1gb", "--yes", "--format", "json"]);

    expect(result.code).toBe(0);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({ created: { id: "r-1", name: "cache", status: "CREATING" }, price: QUOTE });
  });

  it("refuses a name already in use, before pricing anything", async () => {
    routes({ ...REDIS_CATALOG, [`GET ${P}/redis`]: [{ id: "r-1", name: "cache" }] });

    const result = await cli(["redis", "create", "cache", "--plan", "valkey-1gb"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('A redis named "cache" already exists');
    expect(requested()).not.toContain(`GET ${P}/redis/preview?planSlug=valkey-1gb`);
  });

  it("refuses a plan or region the catalogue does not have", async () => {
    routes(REDIS_CATALOG);

    const plan = await cli(["redis", "create", "cache", "--plan", "valkey-64gb"]);
    const region = await cli(["redis", "create", "cache", "--plan", "valkey-1gb", "--region", "us-east"]);

    expect(plan.code).toBe(2);
    expect(plan.stderr).toContain("cosmoner redis plans lists them");
    expect(region.code).toBe(2);
    expect(region.stderr).toContain("Regions: se-sto");
  });

  it("servers create resolves SSH keys by name and asks for a region when there are several", async () => {
    routes({
      [`GET ${BASE}/v1/catalog/servers/sizes`]: [{ slug: "s-1vcpu-1gb" }],
      [`GET ${BASE}/v1/catalog/servers/regions`]: [{ slug: "ams3" }, { slug: "fra1" }],
      [`GET ${P}/servers`]: new Sequence([[], [{ id: "srv-1", name: "box", status: "PROVISIONING" }]]),
      [`GET ${P}/ssh-keys`]: [{ id: "key-1", name: "laptop", fingerprint: "SHA256:x" }],
      [`GET ${P}/servers/preview?provider=digitalocean&slug=s-1vcpu-1gb`]: QUOTE,
      [`POST ${P}/servers`]: { deployed: true },
    });

    const noRegion = await cli(["servers", "create", "box", "--size", "s-1vcpu-1gb"]);
    const ordered = await cli(["servers", "create", "box", "--size", "s-1vcpu-1gb", "--region", "fra1", "--ssh-keys", "laptop", "--yes"]);

    expect(noRegion.code).toBe(2);
    expect(noRegion.stderr).toContain("Pass --region. Regions: ams3, fra1");
    expect(ordered.code).toBe(0);
    expect(bodyOf(`POST ${P}/servers`)).toEqual({ name: "box", slug: "s-1vcpu-1gb", provider: "digitalocean", region: "fra1", sshKeyIds: ["key-1"] });
  });

  it("databases create defaults to the newest version and the only region", async () => {
    routes({
      [`GET ${BASE}/v1/catalog/databases`]: {
        provider: "COSMONER",
        sizes: [{ slug: "db-small" }],
        engines: [{ engine: "POSTGRESQL", versions: ["18", "17", "16"] }],
        regions: [{ slug: "se-sto", name: "Stockholm" }],
        storage: null,
      },
      [`GET ${P}/databases`]: new Sequence([[], [{ id: "db-1", name: "main", kind: "DEDICATED" }]]),
      [`GET ${P}/databases/dedicated/preview?slug=db-small`]: QUOTE,
      [`POST ${P}/databases/dedicated`]: { deployed: true },
    });

    const result = await cli(["databases", "create", "main", "--size", "db-small", "--yes"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/databases/dedicated`)).toEqual({ name: "main", engine: "POSTGRESQL", version: "18", slug: "db-small", region: "se-sto" });
  });

  it("buckets create needs --public for --cdn, before any request", async () => {
    const result = await cli(["buckets", "create", "assets", "--region", "eu-north-1", "--cdn"]);

    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("hosting create sends the site and warns when its database failed", async () => {
    routes({
      [`GET ${P}/hosting/shared/preview?tier=GROWTH&extraStorageGb=10`]: QUOTE,
      [`POST ${P}/hosting/shared`]: { tenantId: "site-1", status: "ACTIVE", databaseError: "quota reached" },
    });

    const result = await cli(["hosting", "create", "blog", "--tier", "growth", "--database", "wp", "--extra-storage", "10", "--yes"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/hosting/shared`)).toEqual({ siteName: "blog", tier: "GROWTH", database: { name: "wp" }, extraStorageGb: 10 });
    expect(result.stderr).toContain("its database was not: quota reached");
  });
});

describe("cosmoner apps create and resize", () => {
  const APP_CATALOG = {
    [`GET ${BASE}/v1/catalog/apps/sizes`]: [{ slug: "apps-s-1vcpu-0.5gb", cpus: 1, cpu_type: "shared", memory_bytes: 536870912, usd_per_month: "5.00" }],
    [`GET ${BASE}/v1/catalog/apps/regions`]: [{ slug: "ams3", label: "Amsterdam" }],
  };

  it("drafts, then checks out an app from an image, inferring its registry", async () => {
    routes({
      ...APP_CATALOG,
      [`GET ${P}/apps/preview?size=apps-s-1vcpu-0.5gb`]: QUOTE,
      [`POST ${P}/apps/draft`]: { draftId: "draft-1" },
      [`POST ${P}/apps`]: { deployed: true, appId: "app-1" },
      [`GET ${P}/apps/app-1`]: { id: "app-1", name: "web", status: "DEPLOYING" },
    });

    const result = await cli(["apps", "create", "web", "--size", "apps-s-1vcpu-0.5gb", "--image", "ghcr.io/acme/web:v1", "--port", "8080", "--yes"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/apps/draft`)).toEqual({
      name: "web",
      size: "apps-s-1vcpu-0.5gb",
      region: "ams3",
      containerRegistry: "ghcr",
      containerImage: "ghcr.io/acme/web:v1",
      containerPublicPort: "8080",
      domainType: "cosmoner",
    });
    expect(bodyOf(`POST ${P}/apps`)).toEqual({ draftId: "draft-1", size: "apps-s-1vcpu-0.5gb" });
  });

  it("builds from a repository", async () => {
    routes({
      ...APP_CATALOG,
      [`GET ${P}/apps/preview?size=apps-s-1vcpu-0.5gb`]: QUOTE,
      [`POST ${P}/apps/draft`]: { draftId: "draft-2" },
      [`POST ${P}/apps`]: { deployed: true, appId: "app-2" },
      [`GET ${P}/apps/app-2`]: { id: "app-2", name: "api" },
    });

    const result = await cli(["apps", "create", "api", "--size", "apps-s-1vcpu-0.5gb", "--repo", "acme/api", "--branch", "main", "--yes"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/apps/draft`)).toMatchObject({ gitProvider: "github", gitRepo: "acme/api", gitBranch: "main", appType: "service" });
  });

  it("needs exactly one of --image and --repo, before any request", async () => {
    expect((await cli(["apps", "create", "web", "--size", "s"])).code).toBe(2);
    expect((await cli(["apps", "create", "web", "--size", "s", "--image", "a", "--repo", "b/c"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resize shows the change in price and asks first", async () => {
    routes({
      [`GET ${P}/apps`]: [{ id: "app-1", name: "web" }],
      [`GET ${P}/apps/app-1/sizes`]: { currentSize: "small", resizable: true, sizes: [{ slug: "small" }, { slug: "large" }] },
      [`GET ${P}/apps/app-1/resize-preview?size=large`]: { ...QUOTE, direction: "upgrade", creditBack: 0, currentMonthly: 500, monthly: 2400, dueToday: 1000 },
      [`PATCH ${P}/apps/app-1/size`]: { instanceSize: "large" },
    });

    const result = await cli(["apps", "resize", "web", "--size", "large"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("It goes from $5.00 to $24.00 a month before tax. About $10.00 is charged now.");
    expect(askYesNo).toHaveBeenCalledWith('Resize app "web"?');
    expect(bodyOf(`PATCH ${P}/apps/app-1/size`)).toEqual({ size: "large" });
  });

  it("resize refuses the size the app already has", async () => {
    routes({
      [`GET ${P}/apps`]: [{ id: "app-1", name: "web" }],
      [`GET ${P}/apps/app-1/sizes`]: { currentSize: "small", resizable: true, sizes: [{ slug: "small" }] },
    });

    const result = await cli(["apps", "resize", "web", "--size", "small"]);

    expect(result.code).toBe(2);
    expect(requested().some((key) => key.startsWith("PATCH"))).toBe(false);
  });
});

describe("catalogue commands", () => {
  it("lists server sizes as a table and Redis plans as JSON", async () => {
    routes({
      [`GET ${BASE}/v1/catalog/servers/sizes`]: [{ slug: "s-1vcpu-1gb", vcpus: 1, memoryMb: 1024, diskGb: 25, transferTb: 1, priceMonthly: 6 }],
      ...REDIS_CATALOG,
    });

    const sizes = await cli(["servers", "sizes"]);
    out = [];
    const plans = await cli(["redis", "plans", "--format", "json"]);

    expect(sizes.stdout).toMatch(/^SIZE\s+VCPUS\s+MEMORY\s+DISK\s+TRANSFER\s+PRICE$/m);
    expect(sizes.stdout).toMatch(/s-1vcpu-1gb\s+1\s+1 GB\s+25 GB\s+1 TB\s+\$6\/mo/);
    expect(JSON.parse(plans.stdout)[0].slug).toBe("valkey-1gb");
  });
});

describe("money", () => {
  it("formats minor units in their currency", () => {
    expect(money(1200, "USD")).toBe("$12.00");
    expect(money(450, "EUR")).toBe("€4.50");
    expect(money(500, "JPY")).toBe("¥500");
  });
});
