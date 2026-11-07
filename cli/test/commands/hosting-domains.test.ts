import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { askYesNo, stdinIsTty } from "../../src/stdin";

/**
 * Drives `cosmoner hosting domains` through the real entry point against a
 * mocked API: listing a site's domains, attaching one, changing what one does
 * and detaching it.
 *
 * What is pinned down: site and hostname names resolve to the ids the API
 * wants; only the behaviour flags given are sent; the DNS records are printed
 * as added or as the user's to add; detaching asks first and changes nothing
 * unasked; and a contradictory command line exits 2 before any request.
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

const H = `${P}/hosting/shared`;
const D = `${H}/site-1/domains`;
const SITES = [{ id: "site-1", siteName: "blog", phpVersion: "8.3", status: "ACTIVE", unixUser: "h_blog_abc" }];
const DOMAINS = [
  {
    id: "dom-1",
    tenantId: "site-1",
    hostname: "example.com",
    kind: "SITE",
    documentRoot: "/var/www/h_blog_abc/example.com/public_html",
    redirectTarget: null,
    redirectStatus: null,
    status: "ACTIVE",
    routingStatus: "ACTIVE",
    createdAt: "2026-11-01T00:00:00.000Z",
  },
  {
    id: "dom-2",
    tenantId: "site-1",
    hostname: "old.example.com",
    kind: "REDIRECT",
    documentRoot: null,
    redirectTarget: "https://example.com",
    redirectStatus: 301,
    status: "ACTIVE",
    routingStatus: "VERIFYING",
    createdAt: "2026-11-02T00:00:00.000Z",
  },
];
const ATTACHED = {
  domainId: "dom-3",
  hostname: "shop.example.com",
  dnsRecordsCreated: false,
  instructions: {
    recordType: "CNAME",
    name: "shop.example.com",
    value: "sites.cosmoner.com",
    ownershipVerification: { type: "txt", name: "_cf-custom-hostname.shop.example.com", value: "abc-123" },
    status: "pending",
  },
};

describe("cosmoner hosting domains", () => {
  it("lists what each domain does and whether it is live", async () => {
    routes({ [`GET ${H}`]: [SITES], [`GET ${D}`]: [DOMAINS] });

    const result = await cli(["hosting", "domains", "blog"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("example.com      serves /example.com/public_html");
    expect(result.stdout).toContain("old.example.com  redirects to https://example.com (301)  waiting for DNS");
  });

  it("attaches a website to its own folder, printing the records to add", async () => {
    routes({ [`GET ${H}`]: [SITES], [`POST ${D}`]: [ATTACHED, 201] });

    const result = await cli(["hosting", "domains", "blog", "attach", "shop.example.com"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${D}`)).toEqual({ hostname: "shop.example.com" });
    expect(result.stdout).toContain("Add these records at your DNS provider");
    expect(result.stdout).toContain("CNAME  shop.example.com");
    expect(result.stdout).toContain("TXT    _cf-custom-hostname.shop.example.com  abc-123");
  });

  it("says the records were added when Cosmoner runs the DNS", async () => {
    routes({ [`GET ${H}`]: [SITES], [`POST ${D}`]: [{ ...ATTACHED, dnsRecordsCreated: true }, 201] });

    const result = await cli(["hosting", "domains", "blog", "attach", "shop.example.com", "--path", "/example.com/shop"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${D}`)).toEqual({ hostname: "shop.example.com", kind: "SITE", path: "example.com/shop" });
    expect(result.stdout).toContain("these records were added for you");
  });

  it("attaches a temporary redirect", async () => {
    routes({ [`GET ${H}`]: [SITES], [`POST ${D}`]: [ATTACHED, 201] });

    await cli(["hosting", "domains", "blog", "attach", "shop.example.com", "--redirect", "https://example.com/shop", "--temporary"]);

    expect(bodyOf(`POST ${D}`)).toEqual({
      hostname: "shop.example.com",
      kind: "REDIRECT",
      redirectTarget: "https://example.com/shop",
      redirectStatus: 302,
    });
  });

  it("changes what a domain does by its hostname", async () => {
    routes({ [`GET ${H}`]: [SITES], [`GET ${D}`]: [DOMAINS], [`PATCH ${D}/dom-2`]: [{}] });

    const result = await cli(["hosting", "domains", "blog", "change", "old.example.com", "--parked"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`PATCH ${D}/dom-2`)).toEqual({ kind: "PARKED" });
  });

  it("detaches only after asking", async () => {
    routes({ [`GET ${H}`]: [SITES], [`GET ${D}`]: [DOMAINS], [`DELETE ${D}/dom-1`]: [{}] });

    const result = await cli(["hosting", "domains", "blog", "detach", "example.com"]);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalledWith('Detach example.com from site "blog"?');
    expect(result.stderr).toContain("Its files stay where they are.");
    expect(requested()).toContain(`DELETE ${D}/dom-1`);
  });

  it("changes nothing when the detach is declined, or asked of a script without --yes", async () => {
    routes({ [`GET ${H}`]: [SITES], [`GET ${D}`]: [DOMAINS] });
    vi.mocked(askYesNo).mockResolvedValue(false);

    expect((await cli(["hosting", "domains", "blog", "detach", "example.com"])).code).not.toBe(0);
    vi.mocked(stdinIsTty).mockReturnValue(false);
    expect((await cli(["hosting", "domains", "blog", "detach", "example.com"])).code).toBe(2);
    expect(requested().some((key) => key.startsWith("DELETE"))).toBe(false);
  });

  it("names the domains a site has when the hostname is not one of them", async () => {
    routes({ [`GET ${H}`]: [SITES], [`GET ${D}`]: [DOMAINS] });

    const result = await cli(["hosting", "domains", "blog", "change", "nope.example.com", "--website"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("It has: example.com, old.example.com.");
  });

  it("refuses a contradictory command line before any request", async () => {
    routes({});

    expect((await cli(["hosting", "domains", "blog", "attach", "x.example.com", "--parked", "--path", "x"])).code).toBe(2);
    expect((await cli(["hosting", "domains", "blog", "attach", "x.example.com", "--temporary"])).code).toBe(2);
    expect((await cli(["hosting", "domains", "blog", "change", "example.com"])).code).toBe(2);
    expect((await cli(["hosting", "domains", "blog", "remove", "example.com"])).code).toBe(2);
    expect((await cli(["hosting", "domains", "blog", "attach"])).code).toBe(2);
    expect((await cli(["hosting", "domains", "blog", "--parked"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
