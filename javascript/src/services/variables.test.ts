import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner } from "../index";

const BASE = "https://api.test.dev/v1/projects/proj-1/variables";

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

/** A project member, as the audit fields embed one. */
const ACTOR = { id: "user-1", name: "Ada", email: "ada@example.com" };

/** A variable, as a read returns it — value and all. */
function variable() {
  return {
    id: "var-1",
    name: "LOG_LEVEL",
    description: "Verbosity",
    value: "debug",
    environment: "development",
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

describe("VariablesService", () => {
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

    it("requires a variableId on get", async () => {
      await expect(client.variables.get("")).rejects.toThrow("variableId is required");
    });

    it("requires a variableId on delete", async () => {
      await expect(client.variables.delete("")).rejects.toThrow("variableId is required");
    });

    it("rejects a lowercase name without asking the API", async () => {
      await expect(client.variables.create({ name: "log_level", value: "debug" })).rejects.toThrow(
        /uppercase letters/
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects an update that changes nothing", async () => {
      await expect(client.variables.update("var-1", {})).rejects.toThrow(
        "Provide a value or description to update"
      );
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

    it("lists variables with their values", async () => {
      fetchSpy.mockResolvedValueOnce(ok([variable()]));

      const result = await client.variables.list();

      expect(result.data[0].value).toBe("debug");
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "GET" }));
    });

    it("scopes a list to one environment", async () => {
      fetchSpy.mockResolvedValueOnce(ok([]));

      await client.variables.list({ environment: "production" });

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}?environment=production`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("creates a variable", async () => {
      fetchSpy.mockResolvedValueOnce(ok(variable(), 201));

      const result = await client.variables.create({ name: "LOG_LEVEL", value: "debug" });

      expect(result.data.name).toBe("LOG_LEVEL");
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "POST" }));
      expect(bodyOf(fetchSpy.mock.calls[0])).toEqual({ name: "LOG_LEVEL", value: "debug" });
    });

    it("updates a description on its own", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ ...variable(), description: "How loud" }));

      await client.variables.update("var-1", { description: "How loud" });

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/var-1`,
        expect.objectContaining({ method: "PATCH" })
      );
      expect(bodyOf(fetchSpy.mock.calls[0])).toEqual({ description: "How loud" });
    });

    it("deletes a variable, tolerating the API's empty 204", async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await expect(client.variables.delete("var-1")).resolves.toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/var-1`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("targets another project per call", async () => {
      fetchSpy.mockResolvedValueOnce(ok([]));

      await client.variables.list({ projectId: "proj-2" });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.test.dev/v1/projects/proj-2/variables",
        expect.objectContaining({ method: "GET" })
      );
    });
  });
});
