import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Cosmoner, RateLimitError } from "../index";
import type { CosmonerError } from "../index";

const URL = "https://api.test.dev/v1/projects/proj-1/email/send";

/** Build a client pointed at the mocked host, with retries disabled. */
function makeClient() {
  return new Cosmoner({
    apiKey: "key-123",
    projectId: "proj-1",
    baseUrl: "https://api.test.dev",
    maxRetries: 0,
  });
}

describe("EmailService", () => {
  let client: Cosmoner;

  beforeEach(() => {
    client = makeClient();
  });

  it("throws when 'to' is missing", async () => {
    await expect(
      client.email.send({
        credentialId: "cred-1",
        to: "",
        subject: "Hello",
        text: "body",
      })
    ).rejects.toThrow("to is required");
  });

  it("throws when 'subject' is missing", async () => {
    await expect(
      client.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "",
        text: "body",
      })
    ).rejects.toThrow("subject is required");
  });

  it("throws when neither html nor text is provided", async () => {
    await expect(
      client.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "Hello",
      })
    ).rejects.toThrow("Either html or text must be provided");
  });

  it("throws when no projectId is available", async () => {
    const scopeless = new Cosmoner({
      apiKey: "key-123",
      baseUrl: "https://api.test.dev",
      maxRetries: 0,
    });

    await expect(
      scopeless.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "Hi",
        text: "body",
      })
    ).rejects.toThrow("projectId is required");
  });

  describe("API calls", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("sends email successfully with text body", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { messageId: "msg-abc" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const result = await client.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "Test",
        text: "Hello world",
      });

      expect(result).toEqual({ success: true, data: { messageId: "msg-abc" } });

      expect(fetchSpy).toHaveBeenCalledWith(
        URL,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer key-123",
          }),
        })
      );
    });

    it("sends the SDK user agent and an idempotency key", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
      );

      await client.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "Test",
        text: "body",
      });

      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers["User-Agent"]).toMatch(/^cosmoner-node\//);
      expect(headers["Idempotency-Key"]).toBeTruthy();
    });

    it("sends email with html body and replyTo", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, data: { messageId: "msg-def" } }),
          { status: 200 }
        )
      );

      const result = await client.email.send({
        credentialId: "cred-1",
        to: ["a@test.com", "b@test.com"],
        subject: "Test",
        html: "<h1>Hi</h1>",
        replyTo: "reply@test.com",
      });

      expect(result.success).toBe(true);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.to).toEqual(["a@test.com", "b@test.com"]);
      expect(body.html).toBe("<h1>Hi</h1>");
      expect(body.replyTo).toBe("reply@test.com");
      expect(body).not.toHaveProperty("text");
    });

    it("lets a per-call projectId override the client default", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
      );

      await client.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "Test",
        text: "body",
        projectId: "proj-2",
      });

      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://api.test.dev/v1/projects/proj-2/email/send"
      );
    });

    it("throws a typed error on API failure", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "RATE_LIMITED", message: "Too many requests" },
          }),
          { status: 429 }
        )
      );

      const promise = client.email.send({
        credentialId: "cred-1",
        to: "user@test.com",
        subject: "Test",
        text: "body",
      });

      await expect(promise).rejects.toBeInstanceOf(RateLimitError);
      await promise.catch((err: CosmonerError) => {
        expect(err.status).toBe(429);
        expect(err.code).toBe("RATE_LIMITED");
        expect(err.message).toBe("Too many requests");
      });
    });

    it("handles error response with missing fields", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 500 })
      );

      await client.email
        .send({
          credentialId: "cred-1",
          to: "user@test.com",
          subject: "Test",
          text: "body",
        })
        .then(
          () => expect.unreachable("Should have thrown"),
          (err: CosmonerError) => {
            expect(err.status).toBe(500);
            expect(err.code).toBe("UNKNOWN");
            expect(err.message).toBe("Unknown error");
          }
        );
    });

    it("surfaces validation details", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid input",
              details: { to: "must be an email" },
            },
          }),
          { status: 422 }
        )
      );

      await client.email
        .send({ credentialId: "cred-1", to: "bad", subject: "Test", text: "body" })
        .catch((err: CosmonerError) => {
          expect(err.details).toEqual({ to: "must be an email" });
        });
    });
  });
});

/** A client for the read tests below, pointed at the mocked host. */
function readClient() {
  return new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: "https://api.test.dev", maxRetries: 0 });
}

/** A 200 response carrying the API's success envelope. */
function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("EmailService domain reads", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists sending domains", async () => {
    fetchSpy.mockResolvedValueOnce(envelope([]));

    await readClient().email.listDomains();

    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.test.dev/v1/projects/proj-1/email");
  });

  it("fetches one sending domain, honouring a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(envelope({ id: "ed-1" }));

    await readClient().email.getDomain("ed-1", { projectId: "proj-2" });

    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.test.dev/v1/projects/proj-2/email/ed-1");
  });

  it("rejects an empty id without a request", async () => {
    await expect(readClient().email.getDomain("")).rejects.toThrow("emailDomainId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
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

describe("EmailService writes", () => {
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

  it("deleteDomain sends DELETE and returns nothing for the 204", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply(null, 204));

    await expect(client.email.deleteDomain("ed-1")).resolves.toBeUndefined();
    expect(writeSent(fetchSpy)).toEqual({ method: "DELETE", url: `${P}/email/ed-1`, body: undefined });
  });

  it("deleteDomain honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply(null, 204));

    await client.email.deleteDomain("ed-1", { projectId: "proj-2" });

    expect(writeSent(fetchSpy).url).toBe(`https://api.test.dev/v1/projects/proj-2/email/ed-1`);
  });

  it("deleteDomain requires an id before any request", async () => {
    await expect(client.email.deleteDomain("")).rejects.toThrow("is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("EmailService credentials", () => {
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

  it("createCredential sends the label and address and returns the password", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "c-1", smtpUsername: "smtp_ab", smtpPassword: "pw" }, 201));

    const result = await client.email.createCredential("ed-1", { label: "app", fromAddress: "noreply@example.com" });

    expect(writeSent(fetchSpy)).toEqual({
      method: "POST",
      url: `${P}/email/ed-1/credentials`,
      body: { label: "app", fromAddress: "noreply@example.com" },
    });
    expect(result.data.smtpPassword).toBe("pw");
  });

  it("deleteCredential sends DELETE and returns nothing for the 204", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply(null, 204));

    await expect(client.email.deleteCredential("ed-1", "c-1", { projectId: "proj-2" })).resolves.toBeUndefined();
    expect(writeSent(fetchSpy)).toEqual({
      method: "DELETE",
      url: "https://api.test.dev/v1/projects/proj-2/email/ed-1/credentials/c-1",
      body: undefined,
    });
  });

  it("requires its arguments before any request", async () => {
    await expect(client.email.createCredential("", { label: "a", fromAddress: "a@b.c" })).rejects.toThrow("emailDomainId is required");
    await expect(client.email.createCredential("ed-1", { label: "a", fromAddress: "" })).rejects.toThrow("fromAddress is required");
    await expect(client.email.deleteCredential("ed-1", "")).rejects.toThrow("credentialId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("EmailService domain setup", () => {
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

  it("createDomain sends the project's domain id", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "ed-1", status: "DNS_PENDING" }, 201));

    const result = await client.email.createDomain({ domainId: "dom-1" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/email`, body: { domainId: "dom-1" } });
    expect(result).toEqual({ success: true, data: { id: "ed-1", status: "DNS_PENDING" } });
  });

  it("createExternalDomain sends the domain name, honouring a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ id: "ed-2" }, 201));

    await client.email.createExternalDomain({ domainName: "example.org", projectId: "proj-2" });

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: "https://api.test.dev/v1/projects/proj-2/email/external", body: { domainName: "example.org" } });
  });

  it("verifyDomain posts and returns each record's state", async () => {
    const data = { status: "ACTIVE", verifiedAt: "2026-10-07T00:00:00.000Z", records: [{ type: "TXT", name: "x", value: "v", purpose: "SPF", description: "d", verified: true, error: null }] };
    fetchSpy.mockResolvedValueOnce(writeReply(data));

    const result = await client.email.verifyDomain("ed-1");

    expect(writeSent(fetchSpy)).toEqual({ method: "POST", url: `${P}/email/ed-1/verify`, body: undefined });
    expect(result).toEqual({ success: true, data });
  });

  it("limits reads the plan and usage", async () => {
    fetchSpy.mockResolvedValueOnce(writeReply({ plan: "PAY_AS_YOU_GO", includedEmails: 0 }));

    const result = await client.email.limits({ projectId: "proj-2" });

    expect(writeSent(fetchSpy)).toEqual({ method: "GET", url: "https://api.test.dev/v1/projects/proj-2/email/limits", body: undefined });
    expect(result).toEqual({ success: true, data: { plan: "PAY_AS_YOU_GO", includedEmails: 0 } });
  });

  it("requires its arguments before any request", async () => {
    await expect(client.email.createDomain({ domainId: "" })).rejects.toThrow("domainId is required");
    await expect(client.email.createExternalDomain({ domainName: "" })).rejects.toThrow("domainName is required");
    await expect(client.email.verifyDomain("")).rejects.toThrow("emailDomainId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
