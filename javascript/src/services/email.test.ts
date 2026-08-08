import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Cosmoner, CosmonerError, RateLimitError } from "../index";

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
