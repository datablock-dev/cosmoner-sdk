import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import type * as Stdin from "../../src/stdin";
import { askYesNo, stdinIsTty } from "../../src/stdin";

/**
 * Drives `iam create`, `email credentials create|delete` and `ssh-keys
 * generate` through the real entry point against a mocked API.
 *
 * What is pinned down: each prints its secret once, in either format, and
 * nothing else of it; names are resolved to the ids the API wants; and
 * `--out` keeps a private key off the screen altogether.
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

/** A JSON response with the API's success envelope, or an empty 204. */
function reply(data: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
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

const IAM_CREATED = {
  iamUserName: "dbd-iam-org-ci",
  label: "ci",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "wJalrSecretValue",
  createdAt: "2026-10-07T00:00:00.000Z",
  origin: "project",
  storage: { access: "read", allBuckets: false, buckets: [{ bucketId: "b-1", bucketName: "assets" }] },
  registry: null,
};

describe("cosmoner iam create", () => {
  it("resolves bucket names and prints the secret key once", async () => {
    routes({
      [`GET ${P}/storage/object-storage`]: [[{ id: "b-1", name: "assets" }]],
      [`POST ${P}/iam`]: [IAM_CREATED, 201],
    });

    const result = await cli(["iam", "create", "ci", "--storage", "read", "--buckets", "assets"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/iam`)).toEqual({ label: "ci", storage: { access: "read", bucketIds: ["b-1"] } });
    expect(result.stdout).toMatch(/Secret access key:\s+wJalrSecretValue/);
    expect(result.stdout).toMatch(/Storage:\s+read on assets/);
    expect(result.stdout).toMatch(/Registry:\s+none/);
    expect(result.stdout).toContain("it is not shown again");
  });

  it("grants every repository when none are named, and prints JSON with only the secret unredacted", async () => {
    routes({
      [`POST ${P}/iam`]: [{ ...IAM_CREATED, storage: null, registry: { access: "push", allRepositories: true, repositories: [] } }, 201],
    });

    const result = await cli(["iam", "create", "deploy", "--registry", "push", "--format", "json"]);

    expect(bodyOf(`POST ${P}/iam`)).toEqual({ label: "deploy", registry: { access: "push" } });
    expect(JSON.parse(result.stdout).secretAccessKey).toBe("wJalrSecretValue");
  });

  it("refuses a bad command line before any request", async () => {
    for (const argv of [
      ["iam", "create", "ci"],
      ["iam", "create", "ci", "--storage", "admin"],
      ["iam", "create", "ci", "--buckets", "assets"],
      ["iam", "create", "a-label-far-too-long-for-iam", "--storage", "read"],
    ]) {
      expect((await cli(argv)).code, argv.join(" ")).toBe(2);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a bucket that does not exist, before creating anything", async () => {
    routes({ [`GET ${P}/storage/object-storage`]: [[{ id: "b-1", name: "assets" }]] });

    const result = await cli(["iam", "create", "ci", "--storage", "read", "--buckets", "nope"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('No bucket "nope"');
  });

  it("never prints the secret on a read", async () => {
    routes({
      [`GET ${P}/iam`]: [{ credentials: [{ ...IAM_CREATED }], errors: [] }],
      [`GET ${P}/iam/dbd-iam-org-ci`]: [{ ...IAM_CREATED }],
    });

    const result = await cli(["iam", "get", "ci", "--format", "json"]);

    expect(result.stdout).not.toContain("wJalrSecretValue");
  });
});

describe("cosmoner email credentials", () => {
  const DOMAIN = {
    id: "ed-1",
    domain: { name: "example.com" },
    credentials: [{ id: "c-1", label: "app", smtpUsername: "smtp_abc", fromAddress: "noreply@example.com" }],
  };

  it("create prints the server, username and password once", async () => {
    routes({
      [`GET ${P}/email`]: [[DOMAIN]],
      [`POST ${P}/email/ed-1/credentials`]: [{ id: "c-2", label: "app2", fromAddress: "hi@example.com", smtpUsername: "smtp_def", smtpPassword: "pw-only-once" }, 201],
    });

    const result = await cli(["email", "credentials", "create", "example.com", "--label", "app2", "--from", "hi@example.com"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/email/ed-1/credentials`)).toEqual({ label: "app2", fromAddress: "hi@example.com" });
    expect(result.stdout).toMatch(/Server:\s+smtp\.cosmoner\.com, port 587/);
    expect(result.stdout).toMatch(/Password:\s+pw-only-once/);
  });

  it("delete finds the credential by username and asks first", async () => {
    routes({ [`GET ${P}/email`]: [[DOMAIN]], [`DELETE ${P}/email/ed-1/credentials/c-1`]: [null, 204] });

    const result = await cli(["email", "credentials", "delete", "example.com", "smtp_abc"]);

    expect(result.code).toBe(0);
    expect(askYesNo).toHaveBeenCalledWith('Delete SMTP credential "app"?');
    expect(result.stdout).toBe('Deleted SMTP credential "app".');
  });

  it("delete without a terminal and without --yes changes nothing", async () => {
    vi.mocked(stdinIsTty).mockReturnValue(false);
    routes({ [`GET ${P}/email`]: [[DOMAIN]] });

    const result = await cli(["email", "credentials", "delete", "example.com", "app"]);

    expect(result.code).toBe(2);
    expect((fetchSpy.mock.calls as Array<[string, RequestInit]>).some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("needs a verb, --label and --from", async () => {
    expect((await cli(["email", "credentials"])).code).toBe(2);
    expect((await cli(["email", "credentials", "create", "example.com", "--from", "a@example.com"])).code).toBe(2);
    expect((await cli(["email", "credentials", "create", "example.com", "--label", "x"])).code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("cosmoner ssh-keys generate", () => {
  const GENERATED = {
    id: "key-9",
    name: "deploy",
    publicKey: "ssh-rsa AAAAB3 deploy",
    fingerprint: "SHA256:xyz",
    privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIsecret\n-----END RSA PRIVATE KEY-----\n",
  };
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cosmoner-keys-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("prints the private key once without --out", async () => {
    routes({ [`POST ${P}/ssh-keys/generate`]: [GENERATED, 201] });

    const result = await cli(["ssh-keys", "generate", "deploy"]);

    expect(result.code).toBe(0);
    expect(bodyOf(`POST ${P}/ssh-keys/generate`)).toEqual({ name: "deploy" });
    expect(result.stdout).toContain("MIIsecret");
  });

  it("writes the key pair with --out and prints neither half's secret", async () => {
    routes({ [`POST ${P}/ssh-keys/generate`]: [GENERATED, 201] });
    const file = join(dir, "deploy_rsa");

    const result = await cli(["ssh-keys", "generate", "deploy", "--out", file]);

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("MIIsecret");
    expect(readFileSync(file, "utf8")).toBe(GENERATED.privateKey);
    expect(readFileSync(`${file}.pub`, "utf8")).toBe("ssh-rsa AAAAB3 deploy\n");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refuses to overwrite, before generating anything", async () => {
    const file = join(dir, "existing");
    writeFileSync(file, "keep me");

    const result = await cli(["ssh-keys", "generate", "deploy", "--out", file]);

    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSync(file, "utf8")).toBe("keep me");
    expect(existsSync(`${file}.pub`)).toBe(false);
  });
});
