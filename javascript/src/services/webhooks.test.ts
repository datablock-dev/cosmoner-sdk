import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner, NotFoundError } from "../index";

const BASE = "https://api.test.dev/v1/projects/proj-1/webhooks";

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

const ENDPOINT = {
  id: "ep-1",
  name: "Billing receiver",
  description: null,
  url: "https://example.com/hooks",
  events: ["email.delivered"],
  enabled: true,
  secretHint: "cdef",
  consecutiveFailures: 0,
  disabledAt: null,
  disabledReason: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  createdAt: "2026-08-08T12:00:00.000Z",
  updatedAt: "2026-08-08T12:00:00.000Z",
};

describe("WebhooksService", () => {
  let client: Cosmoner;

  beforeEach(() => {
    client = makeClient();
  });

  describe("argument validation", () => {
    it("requires an endpointId on get", async () => {
      await expect(client.webhooks.get("")).rejects.toThrow("endpointId is required");
    });

    it("requires an endpointId on delete", async () => {
      await expect(client.webhooks.delete("")).rejects.toThrow("endpointId is required");
    });

    it("requires a deliveryId on replay", async () => {
      await expect(client.webhooks.replayDelivery("ep-1", "")).rejects.toThrow(
        "deliveryId is required"
      );
    });

    it("requires a name on create", async () => {
      await expect(
        client.webhooks.create({ name: "", url: "https://e.com", events: ["email.sent"] })
      ).rejects.toThrow("name is required");
    });

    it("requires a url on create", async () => {
      await expect(
        client.webhooks.create({ name: "Hooks", url: "", events: ["email.sent"] })
      ).rejects.toThrow("url is required");
    });

    it("requires at least one event on create", async () => {
      await expect(
        client.webhooks.create({ name: "Hooks", url: "https://e.com", events: [] })
      ).rejects.toThrow("At least one event is required");
    });

    it("rejects clearing every event on update", async () => {
      await expect(client.webhooks.update("ep-1", { events: [] })).rejects.toThrow(
        "At least one event is required"
      );
    });

    it("requires a projectId when the client has no default", async () => {
      const scopeless = new Cosmoner({
        apiKey: "key-123",
        baseUrl: "https://api.test.dev",
        maxRetries: 0,
      });

      await expect(scopeless.webhooks.list()).rejects.toThrow("projectId is required");
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

    it("lists endpoints", async () => {
      fetchSpy.mockResolvedValueOnce(ok([ENDPOINT]));

      const result = await client.webhooks.list();

      expect(result.data).toEqual([ENDPOINT]);
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "GET" }));
    });

    it("fetches one endpoint with its stats", async () => {
      const stats = { succeeded: 12, failed: 1, pending: 0 };
      fetchSpy.mockResolvedValueOnce(ok({ endpoint: ENDPOINT, stats }));

      const result = await client.webhooks.get("ep-1");

      expect(result.data.stats).toEqual(stats);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/ep-1`,
        expect.objectContaining({ method: "GET" })
      );
    });

    it("creates an endpoint and surfaces the one-time secret", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ ...ENDPOINT, secret: "whsec_full_value" }, 201));

      const result = await client.webhooks.create({
        name: "Billing receiver",
        url: "https://example.com/hooks",
        events: ["email.delivered", "email.bounced"],
        description: "Receipts",
      });

      expect(result.data.secret).toBe("whsec_full_value");

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(init).toMatchObject({ method: "POST" });
      expect(JSON.parse(init!.body as string)).toEqual({
        name: "Billing receiver",
        url: "https://example.com/hooks",
        events: ["email.delivered", "email.bounced"],
        description: "Receipts",
      });
    });

    it("updates an endpoint with PATCH, omitting untouched fields", async () => {
      fetchSpy.mockResolvedValueOnce(ok(ENDPOINT));

      await client.webhooks.update("ep-1", { enabled: false });

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${BASE}/ep-1`);
      expect(init).toMatchObject({ method: "PATCH" });
      // Undefined fields must not be sent — the API treats present keys as edits.
      expect(JSON.parse(init!.body as string)).toEqual({ enabled: false });
    });

    it("sends an explicit null to clear the description", async () => {
      fetchSpy.mockResolvedValueOnce(ok(ENDPOINT));

      await client.webhooks.update("ep-1", { description: null });

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(JSON.parse(init!.body as string)).toEqual({ description: null });
    });

    it("deletes an endpoint", async () => {
      fetchSpy.mockResolvedValueOnce(ok(null));

      const result = await client.webhooks.delete("ep-1");

      expect(result.data).toBeNull();
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/ep-1`,
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("resumes a paused endpoint", async () => {
      fetchSpy.mockResolvedValueOnce(ok(ENDPOINT));

      await client.webhooks.resume("ep-1");

      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/ep-1/resume`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("rotates the signing secret", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ id: "ep-1", secret: "whsec_rotated" }));

      const result = await client.webhooks.rotateSecret("ep-1");

      expect(result.data.secret).toBe("whsec_rotated");
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/ep-1/rotate-secret`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("sends a test event with an explicit type", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ outcome: "SUCCEEDED", delivery: { id: "dlv-1" } }));

      const result = await client.webhooks.test("ep-1", { eventType: "email.bounced" });

      expect(result.data.outcome).toBe("SUCCEEDED");

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe(`${BASE}/ep-1/test`);
      expect(JSON.parse(init!.body as string)).toEqual({ eventType: "email.bounced" });
    });

    it("lets the server pick the test event type when none is given", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ outcome: "SUCCEEDED", delivery: { id: "dlv-1" } }));

      await client.webhooks.test("ep-1");

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(JSON.parse(init!.body as string)).toEqual({});
    });

    it("passes delivery filters through as query parameters", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ deliveries: [], nextCursor: null }));

      await client.webhooks.listDeliveries("ep-1", {
        status: "FAILED",
        eventType: "email.bounced",
        limit: 50,
        cursor: "dlv-9",
      });

      const [url] = fetchSpy.mock.calls[0]!;
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe("/v1/projects/proj-1/webhooks/ep-1/deliveries");
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        status: "FAILED",
        eventType: "email.bounced",
        limit: "50",
        cursor: "dlv-9",
      });
    });

    it("omits absent delivery filters entirely", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ deliveries: [], nextCursor: null }));

      await client.webhooks.listDeliveries("ep-1");

      expect(fetchSpy.mock.calls[0]![0]).toBe(`${BASE}/ep-1/deliveries`);
    });

    it("replays a delivery", async () => {
      fetchSpy.mockResolvedValueOnce(ok({ id: "dlv-2" }, 201));

      const result = await client.webhooks.replayDelivery("ep-1", "dlv-1");

      expect(result.data.id).toBe("dlv-2");
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/ep-1/deliveries/dlv-1/replay`,
        expect.objectContaining({ method: "POST" })
      );
    });

    it("targets another project when projectId is passed per call", async () => {
      fetchSpy.mockResolvedValueOnce(ok([ENDPOINT]));

      await client.webhooks.list({ projectId: "proj-2" });

      expect(fetchSpy.mock.calls[0]![0]).toBe("https://api.test.dev/v1/projects/proj-2/webhooks");
    });

    it("maps a 404 onto NotFoundError", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "NOT_FOUND", message: "Webhook endpoint not found" },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(client.webhooks.get("ep-missing")).rejects.toThrow(NotFoundError);
    });

    it("sends auth and idempotency headers on writes", async () => {
      fetchSpy.mockResolvedValueOnce(ok(ENDPOINT, 201));

      await client.webhooks.create({
        name: "Hooks",
        url: "https://example.com/hooks",
        events: ["email.sent"],
      });

      const [, init] = fetchSpy.mock.calls[0]!;
      expect(init!.headers).toMatchObject({
        Authorization: "Bearer key-123",
        "Content-Type": "application/json",
      });
      expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    });
  });

  describe("verification helpers", () => {
    it("exposes verify on the namespace", () => {
      expect(client.webhooks.verify({ payload: "{}", signature: "garbage", secret: "s" })).toBe(
        false
      );
    });

    it("exposes constructEvent on the namespace", () => {
      expect(() =>
        client.webhooks.constructEvent({ payload: "{}", signature: "garbage", secret: "s" })
      ).toThrow(/Malformed/);
    });
  });
});
