import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Cosmoner, CosmonerError } from "./index";
import type { SendEmailParams } from "./index";

describe("Cosmoner", () => {
  it("initializes with valid config", () => {
    const client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1" });
    expect(client.apiKey).toBe("key-123");
    expect(client.projectId).toBe("proj-1");
    expect(client.baseUrl).toBe("https://api.cosmoner.com");
  });

  it("uses custom baseUrl", () => {
    const client = new Cosmoner({
      apiKey: "key-123",
      projectId: "proj-1",
      baseUrl: "https://custom.api.dev",
    });
    expect(client.baseUrl).toBe("https://custom.api.dev");
  });

  it("strips trailing slash from baseUrl", () => {
    const client = new Cosmoner({
      apiKey: "key-123",
      projectId: "proj-1",
      baseUrl: "https://custom.api.dev/",
    });
    expect(client.baseUrl).toBe("https://custom.api.dev");
  });

  it("throws when apiKey is missing", () => {
    expect(
      () => new Cosmoner({ apiKey: "", projectId: "proj-1" })
    ).toThrow("apiKey is required");
  });

  it("throws when projectId is missing", () => {
    expect(
      () => new Cosmoner({ apiKey: "key-123", projectId: "" })
    ).toThrow("projectId is required");
  });

  it("exposes email service", () => {
    const client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1" });
    expect(client.email).toBeDefined();
    expect(client.email.send).toBeInstanceOf(Function);
  });
});

describe("CosmonerError", () => {
  it("stores status, code, and message", () => {
    const err = new CosmonerError(422, "VALIDATION_ERROR", "Invalid input");
    expect(err.status).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Invalid input");
    expect(err.name).toBe("CosmonerError");
  });

  it("is an instance of Error", () => {
    const err = new CosmonerError(500, "INTERNAL", "fail");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("EmailService", () => {
  let client: Cosmoner;

  beforeEach(() => {
    client = new Cosmoner({
      apiKey: "key-123",
      projectId: "proj-1",
      baseUrl: "https://api.test.dev",
    });
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

      expect(result).toEqual({
        success: true,
        data: { messageId: "msg-abc" },
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.dev/v1/projects/proj-1/email/send",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer key-123",
          },
        })
      );
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
    });

    it("throws CosmonerError on API failure", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "RATE_LIMITED", message: "Too many requests" },
          }),
          { status: 429 }
        )
      );

      try {
        await client.email.send({
          credentialId: "cred-1",
          to: "user@test.com",
          subject: "Test",
          text: "body",
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CosmonerError);
        const e = err as CosmonerError;
        expect(e.status).toBe(429);
        expect(e.code).toBe("RATE_LIMITED");
        expect(e.message).toBe("Too many requests");
      }
    });

    it("handles error response with missing fields", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 500 })
      );

      try {
        await client.email.send({
          credentialId: "cred-1",
          to: "user@test.com",
          subject: "Test",
          text: "body",
        });
        expect.unreachable("Should have thrown");
      } catch (err) {
        const e = err as CosmonerError;
        expect(e.status).toBe(500);
        expect(e.code).toBe("UNKNOWN");
        expect(e.message).toBe("Unknown error");
      }
    });
  });
});
