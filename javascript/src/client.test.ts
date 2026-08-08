import { describe, it, expect } from "vitest";
import { Cosmoner, CosmonerError, RateLimitError } from "./index";

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
    expect(() => new Cosmoner({ apiKey: "", projectId: "proj-1" })).toThrow(
      "apiKey is required"
    );
  });

  it("throws when projectId is explicitly empty", () => {
    expect(() => new Cosmoner({ apiKey: "key-123", projectId: "" })).toThrow(
      "projectId is required"
    );
  });

  it("allows projectId to be omitted", () => {
    const client = new Cosmoner({ apiKey: "key-123" });
    expect(client.projectId).toBeUndefined();
  });

  it("exposes email service", () => {
    const client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1" });
    expect(client.email).toBeDefined();
    expect(client.email.send).toBeInstanceOf(Function);
  });

  it("applies default timeout and retries", () => {
    const client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1" });
    expect(client.timeout).toBe(30_000);
    expect(client.maxRetries).toBe(2);
  });

  it("accepts custom timeout and retries", () => {
    const client = new Cosmoner({
      apiKey: "key-123",
      projectId: "proj-1",
      timeout: 5_000,
      maxRetries: 0,
    });
    expect(client.timeout).toBe(5_000);
    expect(client.maxRetries).toBe(0);
  });

  it("rejects a non-positive timeout", () => {
    expect(
      () => new Cosmoner({ apiKey: "key-123", projectId: "proj-1", timeout: 0 })
    ).toThrow("timeout must be greater than 0");
  });

  it("rejects negative retries", () => {
    expect(
      () => new Cosmoner({ apiKey: "key-123", projectId: "proj-1", maxRetries: -1 })
    ).toThrow("maxRetries cannot be negative");
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

  it("keeps subclasses catchable as the base error", () => {
    const err = new RateLimitError(429, "RATE_LIMITED", "slow down");
    expect(err).toBeInstanceOf(CosmonerError);
    expect(err.name).toBe("RateLimitError");
  });
});
