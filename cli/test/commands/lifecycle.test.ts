import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { askYesNo, stdinIsTty } from "../../src/stdin";

/**
 * Drives the verbs that change something already there — server rename and
 * power, project rename and delete, email domain setup, shared-database
 * password rotation — through the real entry point against a mocked API.
 *
 * What is pinned down: names resolve to the ids the API wants; stop, reboot,
 * rotate-password, project delete and a billed email verification ask first
 * and change nothing unasked; and a rotated password is printed once.
 */

vi.mock("../../src/stdin", async (importOriginal) => ({
  ...(await importOriginal<typeof Stdin>()),
  stdinIsTty: vi.fn(),
  askYesNo: vi.fn(),
}));

const BASE = "https://api.test.dev";
const P = `${BASE}/v1/projects/proj-1`;
const ENV = { COSMONER_API_KEY: "db_key", COSMONER_PROJECT_ID: "proj-1", COSMONER_API_URL: BASE };

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** A JSON response with the API's success envelope, or an API error. */
function reply(data: unknown, status = 200): Response {
  if (status >= 400) {
    return new Response(JSON.stringify({ success: false, error: { code: "CONFLICT", message: String(data) } }), { status, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ success: true, data }), { status, headers: { "Content-Type": "application/json" } });
}

/** Answers requests by "METHOD url", failing the test on any it does not expect. */
function routes(table: Record<string, [unknown, number?]>): void {
  fetchSpy.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    if (!(key in table)) throw new Error(`Unexpected request ${key}`);
    const [data, status] = table[key];
    return Promise.resolve(reply(data, status));
  });
}

/** Every request sent, as "METHOD url". */
function requested(): string[] {
  return (fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>).map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`);
}

/** The JSON body of the request sent as "METHOD url". */
function bodyOf(key: string): unknown {
  const call = (fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>).find(([url, init]) => `${init?.method ?? "GET"} ${String(url)}` === key);
  if (!call) throw new Error(`No request ${key}`);
  return call[1]?.body === undefined ? undefined : JSON.parse(String(call[1].body));
}

/** Runs one command line. */
async function cli(argv: string[], env: NodeJS.ProcessEnv = ENV) {
  const code = await run(argv, "/", false, env);
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

const SERVERS = [{ id: "srv-1", name: "web", status: "RUNNING" }];

describe("cosmoner servers update|start|stop|reboot", () => {
  it("update renames the server it resolved", async () => {
    routes({ [`GET ${P}/servers`]: [SERVERS], [`PATCH ${P}/servers/srv-1`]: [{ id: "srv-1", name: "web-2" }] });

    const result = await cli(["servers", "update", "web", "--name", "web-2"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`PATCH ${P}/servers/srv-1`)).toEqual({ name: "web-2" });
    expect(result.stdout).toBe('Renamed server "web" to "web-2".');
  });

  it("start powers on without asking", async () => {
    routes({ [`GET ${P}/servers`]: [SERVERS], [`POST ${P}/servers/srv-1/actions`]: [{ id: "srv-1", status: "PROVISIONING" }] });

    const result = await cli(["servers", "start", "web"]);

    expect(result.code).toBe(0);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(bodyOf(`POST ${P}/servers/srv-1/actions`)).toEqual({ action: "power_on" });
  });

  it("stop asks first, then cuts the power", async () => {
    routes({ [`GET ${P}/servers`]: [SERVERS], [`POST ${P}/servers/srv-1/actions`]: [{ id: "srv-1", status: "PROVISIONING" }] });

    const result = await cli(["servers", "stop", "web"]);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalledWith('Stop server "web"?');
    expect(result.stderr).toContain("still billed");
    expect(bodyOf(`POST ${P}/servers/srv-1/actions`)).toEqual({ action: "power_off" });
  });

  it("stop and reboot change nothing unasked or declined", async () => {
    routes({ [`GET ${P}/servers`]: [SERVERS] });

    vi.mocked(stdinIsTty).mockReturnValue(false);
    expect((await cli(["servers", "stop", "web"])).code).toBe(2);
    vi.mocked(stdinIsTty).mockReturnValue(true);
    vi.mocked(askYesNo).mockResolvedValue(false);
    expect((await cli(["servers", "reboot", "web"])).code).toBe(1);

    expect(requested().filter((key) => key.startsWith("POST"))).toEqual([]);
  });

  it("reboot --yes posts the reboot", async () => {
    routes({ [`GET ${P}/servers`]: [SERVERS], [`POST ${P}/servers/srv-1/actions`]: [{ id: "srv-1" }] });

    const result = await cli(["servers", "reboot", "web", "--yes"]);

    expect(result.code).toBe(0);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(bodyOf(`POST ${P}/servers/srv-1/actions`)).toEqual({ action: "reboot" });
  });

  it("refuses a bad command line before any request", async () => {
    expect((await cli(["servers", "update", "web"])).code).toBe(2);
    expect((await cli(["servers", "start"])).code).toBe(2);
    expect((await cli(["servers", "start", "web", "--yes"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cosmoner projects update|delete", () => {
  const PROJECTS = [{ id: "p-9", slug: "shop", name: "Shop" }];
  const NO_PROJECT = { COSMONER_API_KEY: "db_key", COSMONER_API_URL: BASE };

  it("update renames the named project, with no default project set", async () => {
    routes({ [`GET ${BASE}/v1/projects`]: [PROJECTS], [`PATCH ${BASE}/v1/projects/p-9`]: [{ id: "p-9", name: "Store", slug: "shop", billingEmail: null }] });

    const result = await cli(["projects", "update", "shop", "--name", "Store"], NO_PROJECT);

    expect(result.code).toBe(0);
    expect(bodyOf(`PATCH ${BASE}/v1/projects/p-9`)).toEqual({ name: "Store" });
    expect(result.stdout).toBe('Renamed project "Shop" to "Store".');
  });

  it("delete asks first and deletes the named project", async () => {
    routes({ [`GET ${BASE}/v1/projects`]: [PROJECTS], [`DELETE ${BASE}/v1/projects/p-9`]: [null] });

    const result = await cli(["projects", "delete", "shop"], NO_PROJECT);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalledWith('Delete project "shop"?');
    expect(result.stdout).toBe('Deleted project "shop".');
  });

  it("delete reports the API's refusal while resources remain", async () => {
    routes({
      [`GET ${BASE}/v1/projects`]: [PROJECTS],
      [`DELETE ${BASE}/v1/projects/p-9`]: ["Remove all resources before deleting the project: 1 server.", 409],
    });

    const result = await cli(["projects", "delete", "shop", "--yes"], NO_PROJECT);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Remove all resources before deleting the project");
  });
});

describe("cosmoner email create|verify", () => {
  const RECORDS = [{ type: "TXT", name: "cosmoner._domainkey.example.com", value: "v=DKIM1; p=abc", purpose: "DKIM", description: "d" }];
  const CREATED = { id: "ed-1", status: "DNS_PENDING", domain: { name: "example.com" }, dnsRecords: RECORDS };

  it("create uses a domain already in the project", async () => {
    routes({ [`GET ${P}/domains`]: [[{ id: "dom-1", name: "example.com" }]], [`POST ${P}/email`]: [CREATED, 201] });

    const result = await cli(["email", "create", "example.com"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/email`)).toEqual({ domainId: "dom-1" });
    expect(result.stdout).toContain("v=DKIM1; p=abc");
    expect(result.stdout).toContain("cosmoner email verify example.com");
  });

  it("create adds any other domain as external", async () => {
    routes({ [`GET ${P}/domains`]: [[]], [`POST ${P}/email/external`]: [CREATED, 201] });

    const result = await cli(["email", "create", "example.com"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/email/external`)).toEqual({ domainName: "example.com" });
  });

  const LISTED = [{ id: "ed-1", domain: { name: "example.com" }, credentials: [] }];
  const verified = { status: "ACTIVE", verifiedAt: "2026-10-07T00:00:00.000Z", records: RECORDS.map((record) => ({ ...record, verified: true, error: null })) };

  it("verify asks before billing a plan with a monthly price, and changes nothing unasked", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({
      [`GET ${P}/email`]: [LISTED],
      [`GET ${P}/email/ed-1`]: [{ ...LISTED[0], sending: { identity: null, billingRequired: true } }],
      [`GET ${P}/email/limits`]: [{ plan: "STARTER", includedEmails: 10000 }],
    });

    const result = await cli(["email", "verify", "example.com"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("starter email plan: its monthly price, covering 10000 emails a month");
    expect(requested()).not.toContain(`POST ${P}/email/ed-1/verify`);
  });

  it("verify does not ask on pay as you go, and exits 0 once active", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({
      [`GET ${P}/email`]: [LISTED],
      [`GET ${P}/email/ed-1`]: [{ ...LISTED[0], sending: { identity: null, billingRequired: true } }],
      [`GET ${P}/email/limits`]: [{ plan: "PAY_AS_YOU_GO", includedEmails: 0 }],
      [`POST ${P}/email/ed-1/verify`]: [verified],
    });

    const result = await cli(["email", "verify", "example.com"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("example.com is verified and can send.");
  });

  it("verify names each record still missing and exits 1", async () => {
    routes({
      [`GET ${P}/email`]: [LISTED],
      [`GET ${P}/email/ed-1`]: [{ ...LISTED[0], sending: { identity: null, billingRequired: false } }],
      [`POST ${P}/email/ed-1/verify`]: [{ status: "DNS_PENDING", verifiedAt: null, records: [{ ...RECORDS[0], verified: false, error: "No TXT record found" }] }],
    });

    const result = await cli(["email", "verify", "example.com"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("not found: No TXT record found");
    expect(requested()).not.toContain(`GET ${P}/email/limits`);
  });
});

describe("cosmoner databases rotate-password", () => {
  const DATABASES = [
    { id: "t-1", name: "shop", kind: "SHARED" },
    { id: "d-1", name: "big", kind: "DEDICATED" },
  ];
  const ROTATED = { password: "new-pw-once", connectionUri: "postgresql://u:new-pw-once@h:5432/shop" };

  it("asks first, then prints the new password and URI once", async () => {
    routes({ [`GET ${P}/databases`]: [DATABASES], [`POST ${P}/databases/shared/t-1/rotate-password`]: [ROTATED] });

    const result = await cli(["databases", "rotate-password", "shop"]);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalledWith('Rotate the password of "shop"?');
    expect(result.stdout).toMatch(/Password:\s+new-pw-once/);
    expect(result.stdout).toMatch(/Connection URI:\s+postgresql:\/\/u:new-pw-once@h:5432\/shop/);
    expect(result.stdout).toContain("it is not shown again");
  });

  it("prints both secrets in JSON", async () => {
    routes({ [`GET ${P}/databases`]: [DATABASES], [`POST ${P}/databases/shared/t-1/rotate-password`]: [ROTATED] });

    const result = await cli(["databases", "rotate-password", "shop", "--yes", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toEqual(ROTATED);
  });

  it("changes nothing unasked, and refuses a dedicated database", async () => {
    routes({ [`GET ${P}/databases`]: [DATABASES] });

    vi.mocked(stdinIsTty).mockReturnValue(false);
    expect((await cli(["databases", "rotate-password", "shop"])).code).toBe(2);
    expect((await cli(["databases", "rotate-password", "big", "--yes"])).code).toBe(2);

    expect(requested().filter((key) => key.startsWith("POST"))).toEqual([]);
  });
});
