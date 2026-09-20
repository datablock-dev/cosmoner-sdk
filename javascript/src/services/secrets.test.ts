import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner, ConflictError, CosmonerError } from "../index";

const BASE = "https://api.test.dev/v1/projects/proj-1/secrets";

/** Build a client pointed at the mocked host, with retries disabled. */
function makeClient() {
  return new Cosmoner({
    apiKey: "key-123",
    projectId: "proj-1",
    baseUrl: "https://api.test.dev",
    maxRetries: 0,
  });
}

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A JSON response with the API's error envelope. */
function fail(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A project member, as the audit fields embed one. */
const ACTOR = { id: "user-1", name: "Ada", email: "ada@example.com" };

/** A secret's metadata, as a read returns it. */
function secret() {
  return {
    id: "sec-1",
    name: "DB_PASSWORD",
    description: "Primary database",
    environment: "production",
    version: 1,
    createdBy: "user-1",
    updatedBy: "user-1",
    createdByUser: ACTOR,
    updatedByUser: ACTOR,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

/** The body of a JSON request the spy captured. */
function bodyOf(call: unknown): Record<string, unknown> {
  const init = (call as [string, RequestInit])[1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("SecretsService", () => {
  let client: Cosmoner;

  beforeEach(() => {
    client = makeClient();
  });

  describe("argument validation", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("requires a secretId on get", async () => {
      await expect(client.secrets.get("")).rejects.toThrow("secretId is required");
    });

    it("requires a secretId on update", async () => {
      await expect(client.secrets.update("", { value: "x" })).rejects.toThrow(
        "secretId is required"
      );
    });

    it("requires a secretId on delete", async () => {
      await expect(client.secrets.delete("")).rejects.toThrow("secretId is required");
    });

    it("requires a secretId on audit", async () => {
      await expect(client.secrets.audit("")).rejects.toThrow("secretId is required");
    });

    it("rejects a lowercase name without asking the API", async () => {
      await expect(client.secrets.create({ name: "db_password", value: "x" })).rejects.toThrow(
        /uppercase letters/
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a name that does not start with a letter", async () => {
      await expect(client.secrets.create({ name: "1_PASSWORD", value: "x" })).rejects.toThrow(
        /uppercase letters/
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects an empty value", async () => {
      await expect(client.secrets.create({ name: "DB_PASSWORD", value: "" })).rejects.toThrow(
        "value is required"
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a value past the API's limit", async () => {
      await expect(
        client.secrets.create({ name: "DB_PASSWORD", value: "x".repeat(10_001) })
      ).rejects.toThrow("value must be at most 10000 characters");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("API calls", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("lists secrets without a query string by default", async () => {
      fetchSpy.mockResolvedValueOnce(ok([secret()]));

      const result = await client.secrets.list();

      expect(result.data[0].name).toBe("DB_PASSWORD");
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "GET" }));
    });

    it("never receives a value on a list", async () => {
      fetchSpy.mockResolvedValueOnce(ok([secret()]));

      const result = await client.secrets.list();

      expect(result.data[0]).not.toHaveProperty("value");
    });

    it("scopes a list to one environment", async () => {
      fetchSpy.mockResolvedValueOnce(ok([]));

      await client.secrets.list({ environment: "staging" });

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}?environment=staging`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("creates a secret and hands back the plaintext once", async () => {
      fetchSpy.mockResolvedValueOnce(
        ok({ ...secret(), value: "hunter2", maskedValue: "hu••••r2" }, 201)
      );

      const result = await client.secrets.create({
        name: "DB_PASSWORD",
        value: "hunter2",
        environment: "production",
      });

      expect(result.data.value).toBe("hunter2");
      expect(result.data.maskedValue).toBe("hu••••r2");
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "POST" }));
      expect(bodyOf(fetchSpy.mock.calls[0])).toEqual({
        name: "DB_PASSWORD",
        value: "hunter2",
        environment: "production",
      });
    });

    it("updates a secret by id", async () => {
      fetchSpy.mockResolvedValueOnce(
        ok({ ...secret(), version: 2, value: "hunter3", maskedValue: "hu••••r3" })
      );

      const result = await client.secrets.update("sec-1", { value: "hunter3" });

      expect(result.data.version).toBe(2);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/sec-1`,
        expect.objectContaining({ method: "PATCH" })
      );
      expect(bodyOf(fetchSpy.mock.calls[0])).toEqual({ value: "hunter3" });
    });

    it("deletes a secret, tolerating the API's empty 204", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await expect(client.secrets.delete("sec-1")).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/sec-1`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("reads usage", async () => {
      fetchSpy.mockResolvedValueOnce(
        ok({
          used: 5,
          limit: 5,
          freeLimit: 5,
          packSize: 5,
          paidPacks: 0,
          packPrice: { monthly: 500, currency: "EUR" },
        })
      );

      const result = await client.secrets.usage();

      expect(result.data.used).toBe(5);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/usage`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("reads an audit trail", async () => {
      fetchSpy.mockResolvedValueOnce(
        ok([
          {
            id: "log-1",
            secretId: "sec-1",
            action: "CREATED",
            actorId: "user-1",
            actor: ACTOR,
            metadata: null,
            createdAt: "2026-09-01T12:00:00.000Z",
          },
        ])
      );

      const result = await client.secrets.audit("sec-1");

      expect(result.data[0].action).toBe("CREATED");
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/sec-1/audit`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("surfaces a duplicate name as a ConflictError", async () => {
      fetchSpy.mockResolvedValueOnce(
        fail(409, "CONFLICT", "A secret with that name already exists in this environment")
      );

      await expect(client.secrets.create({ name: "DB_PASSWORD", value: "x" })).rejects.toThrow(
        ConflictError
      );
    });

    it("surfaces the secrets limit as a 402", async () => {
      fetchSpy.mockResolvedValueOnce(fail(402, "PAYMENT_REQUIRED", "Secret limit reached"));

      await expect(
        client.secrets.create({ name: "DB_PASSWORD", value: "x" })
      ).rejects.toMatchObject({ status: 402, code: "PAYMENT_REQUIRED" });
    });

    it("surfaces a member's missing admin role as a 403", async () => {
      fetchSpy.mockResolvedValueOnce(
        fail(403, "FORBIDDEN", "Only owners and admins can manage secrets")
      );

      await expect(client.secrets.delete("sec-1")).rejects.toThrow(CosmonerError);
    });

    it("targets another project per call", async () => {
      fetchSpy.mockResolvedValueOnce(ok([]));

      await client.secrets.list({ projectId: "proj-2" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.dev/v1/projects/proj-2/secrets",
        expect.objectContaining({ method: "GET" })
      );
    });
  });
});
