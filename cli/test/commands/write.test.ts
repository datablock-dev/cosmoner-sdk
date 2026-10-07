import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { askYesNo, readStdin, stdinIsTty } from "../../src/stdin";

/**
 * Drives the write verbs — `delete`, `create`, `update`, `verify`, `test`,
 * `rotate-secret` — through the real entry point against a mocked API.
 *
 * What is pinned down is what a person or an agent relies on: nothing changes
 * until the confirmation says so, a script without a terminal is refused
 * rather than left waiting, each verb sends the request it claims to, and a
 * signing secret is printed by the command that creates it and by no other.
 */

vi.mock("../../src/stdin", async (importOriginal) => ({
  ...(await importOriginal<typeof Stdin>()),
  readStdin: vi.fn(),
  stdinIsTty: vi.fn(),
  askYesNo: vi.fn(),
}));

const BASE = "https://api.test.dev";
const P = `${BASE}/v1/projects/proj-1`;
const ENV = { COSMONER_API_KEY: "db_key", COSMONER_PROJECT_ID: "proj-1", COSMONER_API_URL: BASE };

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** A JSON response with the API's success envelope, or an empty 204. */
function reply(data: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers requests by "METHOD url", failing the test on any it does not expect. */
function routes(table: Record<string, Response | (() => Response)>): void {
  fetchSpy.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const answer = table[key];
    if (answer === undefined) throw new Error(`Unexpected request ${key}`);
    return Promise.resolve(typeof answer === "function" ? answer() : answer.clone());
  });
}

/** Every request sent, as "METHOD url". */
function requested(): string[] {
  return (fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>).map(
    ([url, init]) => `${init?.method ?? "GET"} ${String(url)}`
  );
}

/** The JSON body of the request sent as "METHOD url". */
function bodyOf(key: string): unknown {
  const call = (fetchSpy.mock.calls as Array<[string, RequestInit | undefined]>).find(
    ([url, init]) => `${init?.method ?? "GET"} ${String(url)}` === key
  );
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(stdinIsTty).mockReset();
  vi.mocked(askYesNo).mockReset();
  vi.mocked(readStdin).mockReset();
});

const APP = { id: "app-1", name: "web", status: "RUNNING" };

describe("cosmoner <product> delete", () => {
  it("asks, and deletes on yes", async () => {
    vi.mocked(askYesNo).mockResolvedValue(true);
    routes({ [`GET ${P}/apps`]: reply([APP]), [`DELETE ${P}/apps/app-1`]: reply({}) });

    const result = await cli(["apps", "delete", "web"]);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalledWith('Delete app "web"?');
    expect(result.stderr).toContain("deployments go with it");
    expect(result.stdout).toBe('Deleted app "web".');
    expect(requested()).toEqual([`GET ${P}/apps`, `DELETE ${P}/apps/app-1`]);
  });

  it("changes nothing on no, and exits 1", async () => {
    vi.mocked(askYesNo).mockResolvedValue(false);
    routes({ [`GET ${P}/apps`]: reply([APP]) });

    const result = await cli(["apps", "delete", "web"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Cancelled. Nothing was changed.");
    expect(requested()).toEqual([`GET ${P}/apps`]);
  });

  it("refuses without a terminal and without --yes, exiting 2", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({ [`GET ${P}/apps`]: reply([APP]) });

    const result = await cli(["apps", "delete", "web"]);

    expect(result.code).toBe(2);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(result.stderr).toContain('This deletes app "web".');
    expect(result.stderr).toContain("Rerun with --yes to confirm.");
    expect(requested()).toEqual([`GET ${P}/apps`]);
  });

  it("goes ahead with --yes without asking, terminal or not", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({ [`GET ${P}/redis`]: reply([{ id: "r-1", name: "cache" }]), [`DELETE ${P}/redis/r-1`]: reply({}) });

    const result = await cli(["redis", "rm", "cache", "--yes", "--format", "json"]);

    expect(result.code).toBe(0);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({ deleted: { id: "r-1", name: "cache" } });
  });

  it("exits 1 for a name that matches nothing, before asking", async () => {
    routes({ [`GET ${P}/apps`]: reply([APP]) });

    const result = await cli(["apps", "delete", "nope"]);

    expect(result.code).toBe(1);
    expect(askYesNo).not.toHaveBeenCalled();
    expect(result.stderr).toContain('No app "nope" in this project.');
  });

  it("deletes a database by its kind", async () => {
    routes({
      [`GET ${P}/databases`]: reply([
        { id: "db-1", name: "main", kind: "DEDICATED" },
        { id: "t-1", name: "small", kind: "LEGACY_POOLED" },
      ]),
      [`DELETE ${P}/databases/dedicated/db-1`]: reply({}),
      [`DELETE ${P}/databases/shared/t-1`]: reply({}),
    });

    expect((await cli(["databases", "delete", "main", "--yes"])).code).toBe(0);
    expect((await cli(["databases", "delete", "small", "--yes"])).code).toBe(0);
    expect(requested()).toContain(`DELETE ${P}/databases/dedicated/db-1`);
    expect(requested()).toContain(`DELETE ${P}/databases/shared/t-1`);
  });

  it("routes each product's delete to its own endpoint", async () => {
    routes({
      [`GET ${P}/servers`]: reply([{ id: "srv-1", name: "box" }]),
      [`DELETE ${P}/servers/srv-1`]: reply({}),
      [`GET ${P}/storage/object-storage`]: reply([{ id: "b-1", name: "assets" }]),
      [`DELETE ${P}/storage/object-storage/b-1`]: reply({}),
      [`GET ${P}/storage/container-registry`]: reply([{ id: "reg-1", name: "main" }]),
      [`DELETE ${P}/storage/container-registry/reg-1`]: reply({}),
      [`GET ${P}/hosting/shared`]: reply([{ id: "site-1", siteName: "blog" }]),
      [`DELETE ${P}/hosting/shared/site-1`]: reply({}),
      [`GET ${P}/email`]: reply([{ id: "ed-1", domain: { name: "mail.example.com" } }]),
      [`DELETE ${P}/email/ed-1`]: reply(null, 204),
      [`GET ${P}/iam`]: reply({ credentials: [{ iamUserName: "dbd-iam-u1", label: "ci" }], errors: [] }),
      [`DELETE ${P}/iam/dbd-iam-u1`]: reply(null, 204),
      [`GET ${P}/domains`]: reply([{ id: "dom-1", name: "example.com" }]),
      [`DELETE ${P}/domains/dom-1`]: reply({ id: "dom-1" }),
      [`GET ${P}/ssh-keys`]: reply([{ id: "key-1", name: "laptop", fingerprint: "SHA256:x" }]),
      [`DELETE ${P}/ssh-keys/key-1`]: reply({ stillAuthorisedOn: 0 }),
      [`GET ${P}/webhooks`]: reply([{ id: "wh-1", name: "deploys" }]),
      [`DELETE ${P}/webhooks/wh-1`]: reply(null),
    });

    for (const [product, ref] of [
      ["servers", "box"],
      ["buckets", "assets"],
      ["registries", "main"],
      ["hosting", "blog"],
      ["email", "mail.example.com"],
      ["iam", "ci"],
      ["domains", "example.com"],
      ["ssh-keys", "laptop"],
      ["webhooks", "deploys"],
    ]) {
      expect((await cli([product, "delete", ref, "--yes"])).code, product).toBe(0);
    }
    expect(requested().filter((key) => key.startsWith("DELETE"))).toHaveLength(9);
  });

  it("exits 2 for a delete with no name, before any request", async () => {
    expect((await cli(["apps", "delete"])).code).toBe(2);
    expect((await cli(["apps", "delete", "web", "extra"])).code).toBe(2);
    expect((await cli(["projects", "delete", "acme"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cosmoner ssh-keys create", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cosmoner-ssh-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sends the public key from a file", async () => {
    const file = join(dir, "id_ed25519.pub");
    writeFileSync(file, "ssh-ed25519 AAAAC3 laptop\n");
    routes({ [`POST ${P}/ssh-keys`]: reply({ id: "key-1", name: "laptop", fingerprint: "SHA256:abc" }, 201) });

    const result = await cli(["ssh-keys", "create", "laptop", "--public-key", file]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/ssh-keys`)).toEqual({ name: "laptop", publicKey: "ssh-ed25519 AAAAC3 laptop" });
    expect(result.stdout).toBe('Added ssh-key "laptop" (SHA256:abc).');
  });

  it("reads the key from stdin with -", async () => {
    vi.mocked(readStdin).mockReturnValue("ssh-ed25519 AAAAC3 ci\n");
    routes({ [`POST ${P}/ssh-keys`]: reply({ id: "key-2", name: "ci", fingerprint: "SHA256:def" }, 201) });

    expect((await cli(["ssh-keys", "create", "ci", "--public-key", "-"])).code).toBe(0);
    expect(bodyOf(`POST ${P}/ssh-keys`)).toEqual({ name: "ci", publicKey: "ssh-ed25519 AAAAC3 ci" });
  });

  it("refuses a private key, before any request", async () => {
    const file = join(dir, "id_ed25519");
    writeFileSync(file, "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n");

    const result = await cli(["ssh-keys", "create", "laptop", "--public-key", file]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("That is a private key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exits 2 without --public-key", async () => {
    expect((await cli(["ssh-keys", "create", "laptop"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cosmoner domains create and verify", () => {
  it("adds an external domain and prints the record to publish", async () => {
    routes({
      [`POST ${P}/domains`]: reply(
        {
          id: "dom-1",
          name: "example.com",
          verificationRecord: { type: "TXT", name: "_cosmoner-challenge.example.com", value: "cosmoner-domain-verification=dom-1" },
        },
        201
      ),
    });

    const result = await cli(["domains", "create", "example.com"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/domains`)).toEqual({ name: "example.com", type: "EXTERNAL" });
    expect(result.stdout).toContain("TXT  _cosmoner-challenge.example.com  cosmoner-domain-verification=dom-1");
    expect(result.stdout).toContain("cosmoner domains verify example.com");
  });

  it("exits 0 once verified and 1 while still pending", async () => {
    const record = { type: "TXT", name: "_cosmoner-challenge.example.com", value: "v" };
    let verified = false;
    routes({
      [`POST ${P}/domains/example.com/verify`]: () =>
        reply({ status: verified ? "ACTIVE" : "PENDING", verified, record }),
    });

    const pending = await cli(["domains", "verify", "example.com"]);
    verified = true;
    const done = await cli(["domains", "verify", "example.com"]);

    expect(pending.code).toBe(1);
    expect(pending.stdout).toContain("not verified yet");
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("example.com is verified.");
  });
});

describe("cosmoner webhooks", () => {
  const ENDPOINT = { id: "wh-1", name: "deploys", url: "https://hooks.example.com/x", events: ["app.deployed"], enabled: true, secretHint: "c0de" };

  it("create prints the signing secret once, in both formats", async () => {
    routes({ [`POST ${P}/webhooks`]: reply({ ...ENDPOINT, secret: "whsec_live_secret" }, 201) });

    const text = await cli(["webhooks", "create", "deploys", "--url", ENDPOINT.url, "--events", "app.deployed,app.failed"]);
    out = [];
    const json = await cli(["webhooks", "create", "deploys", "--url", ENDPOINT.url, "--events", "app.deployed", "--format", "json"]);

    expect(text.code).toBe(0);
    expect(bodyOf(`POST ${P}/webhooks`)).toEqual({ name: "deploys", url: ENDPOINT.url, events: ["app.deployed", "app.failed"] });
    expect(text.stdout).toContain("whsec_live_secret");
    expect(text.stdout).toContain("it is not shown again");
    expect(JSON.parse(json.stdout).secret).toBe("whsec_live_secret");
  });

  it("never prints the secret on a read", async () => {
    routes({
      [`GET ${P}/webhooks`]: reply([{ ...ENDPOINT, secret: "whsec_live_secret" }]),
      [`GET ${P}/webhooks/wh-1`]: reply({ endpoint: { ...ENDPOINT, secret: "whsec_live_secret" } }),
    });

    const result = await cli(["webhooks", "get", "deploys", "--format", "json"]);

    expect(result.stdout).not.toContain("whsec_live_secret");
  });

  it("create rejects an unknown event, before any request", async () => {
    const result = await cli(["webhooks", "create", "x", "--url", ENDPOINT.url, "--events", "app.exploded"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown event "app.exploded"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("update resolves the name and sends only what changed", async () => {
    routes({ [`GET ${P}/webhooks`]: reply([ENDPOINT]), [`PATCH ${P}/webhooks/wh-1`]: reply({ ...ENDPOINT, enabled: false }) });

    const result = await cli(["webhooks", "update", "deploys", "--disable"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`PATCH ${P}/webhooks/wh-1`)).toEqual({ enabled: false });
  });

  it("update needs a change, and only one of --enable and --disable", async () => {
    expect((await cli(["webhooks", "update", "deploys"])).code).toBe(2);
    expect((await cli(["webhooks", "update", "deploys", "--enable", "--disable"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("test exits 1 when the delivery failed", async () => {
    routes({
      [`GET ${P}/webhooks`]: reply([ENDPOINT]),
      [`POST ${P}/webhooks/wh-1/test`]: reply({ outcome: "FAILED", delivery: { eventType: "app.deployed", status: "FAILED", responseStatus: 500 } }),
    });

    const result = await cli(["webhooks", "test", "deploys"]);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Failed: app.deployed");
    expect(result.stdout).toContain("HTTP 500");
  });

  it("rotate-secret asks first, then prints the new secret", async () => {
    vi.mocked(askYesNo).mockResolvedValue(true);
    routes({ [`GET ${P}/webhooks`]: reply([ENDPOINT]), [`POST ${P}/webhooks/wh-1/rotate-secret`]: reply({ id: "wh-1", secret: "whsec_new" }) });

    const result = await cli(["webhooks", "rotate-secret", "deploys"]);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalled();
    expect(result.stdout).toContain("whsec_new");
  });

  it("rotate-secret without a terminal and without --yes changes nothing", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({ [`GET ${P}/webhooks`]: reply([ENDPOINT]) });

    const result = await cli(["webhooks", "rotate-secret", "deploys"]);

    expect(result.code).toBe(2);
    expect(requested()).toEqual([`GET ${P}/webhooks`]);
  });
});

describe("cosmoner apps update", () => {
  it("resolves the app and sends the changes with the API's names", async () => {
    routes({ [`GET ${P}/apps`]: reply([APP]), [`PATCH ${P}/apps/app-1`]: reply({ ...APP, name: "web" }) });

    const result = await cli([
      "apps", "update", "web",
      "--instances", "3",
      "--build-command", "",
      "--auto-deploy", "off",
      "--image-deploy-policy", "newest",
    ]);

    expect(result.code).toBe(0);
    expect(bodyOf(`PATCH ${P}/apps/app-1`)).toEqual({
      instances: 3,
      buildCommand: null,
      autoDeploy: false,
      imageDeployPolicy: "NEWEST",
    });
    expect(result.stdout).toBe('Updated app "web".');
  });

  it("exits 2 for no change or a bad value, before any request", async () => {
    expect((await cli(["apps", "update", "web"])).code).toBe(2);
    expect((await cli(["apps", "update", "web", "--instances", "0"])).code).toBe(2);
    expect((await cli(["apps", "update", "web", "--auto-deploy", "maybe"])).code).toBe(2);
    expect((await cli(["apps", "update", "web", "--image-deploy-policy", "latest"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
