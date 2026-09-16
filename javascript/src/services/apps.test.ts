import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner, ValidationError } from "../index";

const BASE = "https://api.test.dev/v1/projects/proj-1/apps";
const DIGEST = `sha256:${"a".repeat(64)}`;

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

/** A deployment in the given phase. */
function deployment(phase: string) {
  return {
    id: "dep-1",
    phase,
    cause: "api deploy",
    imageRef: "registry.cosmoner.com/acme/web:v2",
    imageDigest: null,
    error: phase === "ERROR" ? "ImagePullBackOff" : null,
    startedAt: "2026-09-16T12:00:00.000Z",
    finishedAt: null,
  };
}

describe("AppsService", () => {
  let client: Cosmoner;

  beforeEach(() => {
    client = makeClient();
  });

  describe("argument validation", () => {
    it("requires an appId on deploy", async () => {
      await expect(client.apps.deploy("")).rejects.toThrow("appId is required");
    });

    it("rejects a tag and a digest together", async () => {
      await expect(client.apps.deploy("app-1", { tag: "v2", digest: DIGEST })).rejects.toThrow(
        "Pass either tag or digest, not both"
      );
    });

    it("rejects a tag Docker would not accept", async () => {
      await expect(client.apps.deploy("app-1", { tag: "feature/login" })).rejects.toThrow(
        'Invalid image tag "feature/login"'
      );
    });

    it("rejects a digest without its algorithm", async () => {
      await expect(client.apps.deploy("app-1", { digest: "a".repeat(64) })).rejects.toThrow(
        "digest must be sha256:<64 hex characters>"
      );
    });

    it("requires a deploymentId on getDeployment", async () => {
      await expect(client.apps.getDeployment("app-1", "")).rejects.toThrow(
        "deploymentId is required"
      );
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

    it("lists apps", async () => {
      fetchSpy.mockResolvedValueOnce(ok([{ id: "app-1", name: "web" }]));

      const result = await client.apps.list();

      expect(result.data[0].name).toBe("web");
      expect(fetchSpy).toHaveBeenCalledWith(BASE, expect.objectContaining({ method: "GET" }));
    });

    it("deploys a tag", async () => {
      fetchSpy.mockResolvedValueOnce(ok(deployment("PENDING"), 202));

      const result = await client.apps.deploy("app-1", { tag: "v2" });

      expect(result.data.phase).toBe("PENDING");
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE}/app-1/deployments`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ tag: "v2" });
    });

    it("deploys a digest", async () => {
      fetchSpy.mockResolvedValueOnce(ok(deployment("PENDING"), 202));

      await client.apps.deploy("app-1", { digest: DIGEST });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ digest: DIGEST });
    });

    it("sends an empty body to redeploy the current image", async () => {
      fetchSpy.mockResolvedValueOnce(ok(deployment("PENDING"), 202));

      await client.apps.deploy("app-1");

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({});
    });

    it("surfaces the API refusing a git-source app", async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: "BAD_REQUEST", message: "Git-source apps are rebuilt with POST .../deploy" },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(client.apps.deploy("app-1")).rejects.toBeInstanceOf(ValidationError);
    });

    it("fetches a deployment", async () => {
      fetchSpy.mockResolvedValueOnce(ok(deployment("DEPLOYING")));

      const result = await client.apps.getDeployment("app-1", "dep-1");

      expect(result.data.phase).toBe("DEPLOYING");
      expect(fetchSpy).toHaveBeenCalledWith(
        `${BASE}/app-1/deployments/dep-1`,
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("waitForDeployment", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fetchSpy = vi.spyOn(globalThis, "fetch");
      vi.useFakeTimers();
    });

    afterEach(() => {
      fetchSpy.mockRestore();
      vi.useRealTimers();
    });

    it("polls until the deployment finishes", async () => {
      fetchSpy
        .mockResolvedValueOnce(ok(deployment("PENDING")))
        .mockResolvedValueOnce(ok(deployment("DEPLOYING")))
        .mockResolvedValueOnce(ok(deployment("ACTIVE")));
      const phases: string[] = [];

      const waiting = client.apps.waitForDeployment("app-1", "dep-1", {
        interval: 1_000,
        onPoll: (d) => phases.push(d.phase),
      });
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(waiting).resolves.toMatchObject({ phase: "ACTIVE" });
      expect(phases).toEqual(["PENDING", "DEPLOYING", "ACTIVE"]);
    });

    it("resolves with a failed deployment rather than rejecting", async () => {
      fetchSpy.mockResolvedValueOnce(ok(deployment("ERROR")));

      const result = await client.apps.waitForDeployment("app-1", "dep-1");

      expect(result.phase).toBe("ERROR");
      expect(result.error).toBe("ImagePullBackOff");
    });

    it("rejects once the timeout passes", async () => {
      fetchSpy.mockImplementation(() => Promise.resolve(ok(deployment("DEPLOYING"))));

      const waiting = client.apps.waitForDeployment("app-1", "dep-1", {
        interval: 1_000,
        timeout: 2_500,
      });
      const assertion = expect(waiting).rejects.toThrow("still DEPLOYING after 3s");
      await vi.advanceTimersByTimeAsync(3_000);

      await assertion;
    });
  });
});
