import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner } from "../index";

const API = "https://api.test.dev";

/** Build a client pointed at the mocked host, with retries disabled. */
function makeClient() {
  return new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: API, maxRetries: 0 });
}

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The URL and method of the one request the spy captured. */
function sent(fetchSpy: ReturnType<typeof vi.spyOn>): { url: string; method: string } {
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method ?? "GET" };
}

describe("SshKeysService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = makeClient();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists the project's SSH keys", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.sshKeys.list();

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-1/ssh-keys`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });

  it("honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ id: "x" }));

    const result = await client.sshKeys.list({ projectId: "proj-2" });

    expect(sent(fetchSpy)).toEqual({ url: `${API}/v1/projects/proj-2/ssh-keys`, method: "GET" });
    expect(result).toEqual({ success: true, data: { id: "x" } });
  });
});

/** A reply for the write tests below: the API's envelope, or an empty 204. */
function writeReply(data: unknown, status = 200): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The one request a write test sent: its method, URL and parsed JSON body. */
function writeSent(spy: ReturnType<typeof vi.spyOn>): { method: string; url: string; body: unknown } {
  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  return { method: init.method ?? "GET", url, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
}

describe("SshKeysService writes", () => {
  const P = "https://api.test.dev/v1/projects/proj-1";
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: "https://api.test.dev", maxRetries: 0 });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delete sends DELETE and returns the envelope", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ stillAuthorisedOn: 2 }));

    const result = await client.sshKeys.delete("key-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/ssh-keys/key-1`, body: undefined });
    expect(result).toEqual({ success: true, data: { stillAuthorisedOn: 2 } });
  });

  it("delete honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ stillAuthorisedOn: 2 }, 200));

    await client.sshKeys.delete("key-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/ssh-keys/key-1`);
  });

  it("delete requires an id before any request", async () => {
    await expect(client.sshKeys.delete("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("create sends the name and public key", async () => {
    const key = { id: "key-1", name: "laptop", publicKey: "ssh-ed25519 AAAA laptop", fingerprint: "SHA256:x" };
    fetchSpy.mockResolvedValueOnce(writeReply(key, 201));

    const result = await client.sshKeys.create({ name: "laptop", publicKey: "ssh-ed25519 AAAA laptop" });

    expect(writeSent(fetchSpy)).toEqual({
      method: "POST",
      url: `${P}/ssh-keys`,
      body: { name: "laptop", publicKey: "ssh-ed25519 AAAA laptop" },
    });
    expect(result).toEqual({ success: true, data: key });
  });

  it("create requires a name and a key before any request", async () => {
    await expect(client.sshKeys.create({ name: "", publicKey: "ssh-ed25519 AAAA" })).rejects.toThrow("name is required");
    await expect(client.sshKeys.create({ name: "laptop", publicKey: "" })).rejects.toThrow("publicKey is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SshKeysService credentials", () => {
  const P = "https://api.test.dev/v1/projects/proj-1";
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: "https://api.test.dev", maxRetries: 0 });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generate returns the private key", async () => {
    const key = { id: "key-1", name: "deploy", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n" };
    fetchSpy.mockResolvedValueOnce(writeReply(key, 201));

    const result = await client.sshKeys.generate({ name: "deploy" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/ssh-keys/generate`, body: { name: "deploy" } });
    expect(result.data.privateKey).toContain("BEGIN RSA PRIVATE KEY");
  });

  it("generate requires a name before any request", async () => {
    await expect(client.sshKeys.generate({ name: "" })).rejects.toThrow("name is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
