import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";

/**
 * Drives `cosmoner deploy` through the real entry point against a mocked API,
 * asserting on exit codes and output the way a CI job would read them.
 */

const API = "https://api.test.dev/v1/projects/proj-1/apps";
const ENV = {
  COSMONER_API_KEY: "key-123",
  COSMONER_PROJECT_ID: "proj-1",
  COSMONER_API_URL: "https://api.test.dev",
};

const IMAGE_APP = {
  id: "app-1",
  name: "web",
  gitRepo: null,
  containerImage: "registry.cosmoner.com/acme/web:latest",
};
const GIT_APP = { id: "app-2", name: "site", gitRepo: "acme/site", containerImage: null };

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A deployment of app-1 in the given phase. */
function deployment(phase: string, error: string | null = null) {
  return {
    id: "dep-1",
    phase,
    cause: "api deploy",
    imageRef: "registry.cosmoner.com/acme/web:v2",
    imageDigest: null,
    error,
    startedAt: "2026-09-16T12:00:00.000Z",
    finishedAt: null,
  };
}

/** Runs `cosmoner deploy` with the given arguments, letting poll timers elapse. */
async function deploy(argv: string[], env: Record<string, string> = ENV) {
  const result = Promise.resolve(run(["deploy", ...argv], "/", false, env));
  await vi.runAllTimersAsync();
  const code = await result;
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** The JSON body of the deploy request, which is the second call after the app list. */
function deployBody(): unknown {
  const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
  expect(url).toBe(`${API}/app-1/deployments`);
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  out = [];
  err = [];
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("deploy", () => {
  it("deploys a tag by app name and waits for it to go live", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([GIT_APP, IMAGE_APP]))
      .mockResolvedValueOnce(ok(deployment("PENDING"), 202))
      .mockResolvedValueOnce(ok(deployment("DEPLOYING")))
      .mockResolvedValueOnce(ok(deployment("ACTIVE")));

    const result = await deploy(["web", "--tag", "v2"]);

    expect(result.code).toBe(0);
    expect(deployBody()).toEqual({ tag: "v2" });
    expect(result.stdout).toContain("Deploying web (tag v2)");
    expect(result.stdout).toContain("DEPLOYING");
    expect(result.stdout).toContain("✓ web is live on registry.cosmoner.com/acme/web:v2");
  });

  it("accepts an app id", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([IMAGE_APP]))
      .mockResolvedValueOnce(ok(deployment("ACTIVE"), 202))
      .mockResolvedValueOnce(ok(deployment("ACTIVE")));

    expect((await deploy(["app-1"])).code).toBe(0);
    expect(deployBody()).toEqual({});
  });

  it("adds the sha256: prefix to a bare digest", async () => {
    const hex = "ab".repeat(32);
    fetchSpy
      .mockResolvedValueOnce(ok([IMAGE_APP]))
      .mockResolvedValueOnce(ok(deployment("PENDING"), 202));

    expect((await deploy(["web", "--digest", hex, "--no-wait"])).code).toBe(0);
    expect(deployBody()).toEqual({ digest: `sha256:${hex}` });
  });

  it("exits 1 with the platform's reason when the rollout fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([IMAGE_APP]))
      .mockResolvedValueOnce(ok(deployment("PENDING"), 202))
      .mockResolvedValueOnce(ok(deployment("ERROR", "ImagePullBackOff")));

    const result = await deploy(["web", "--tag", "v2"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("web failed to deploy: ImagePullBackOff");
  });

  it("exits 1 when the wait times out", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([IMAGE_APP]))
      .mockImplementation(() => Promise.resolve(ok(deployment("DEPLOYING"))));

    const result = await deploy(["web", "--timeout", "10"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("still DEPLOYING after 10s");
  });

  it("prints only JSON with --format json", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok([IMAGE_APP]))
      .mockResolvedValueOnce(ok(deployment("PENDING"), 202))
      .mockResolvedValueOnce(ok(deployment("ACTIVE")));

    const result = await deploy(["web", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toMatchObject({
      app: { id: "app-1", name: "web" },
      deployment: { phase: "ACTIVE" },
    });
  });

  it("exits 1 for an app that does not exist", async () => {
    fetchSpy.mockResolvedValueOnce(ok([IMAGE_APP]));

    const result = await deploy(["api"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No app named "api"');
  });

  it("refuses a git-source app without calling the deploy route", async () => {
    fetchSpy.mockResolvedValueOnce(ok([GIT_APP]));

    const result = await deploy(["site"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("built from acme/site");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when the API refuses the key", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, error: { code: "INVALID_API_KEY", message: "Invalid API key" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await deploy(["web"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Invalid API key (INVALID_API_KEY)");
  });

  describe("usage", () => {
    it("exits 2 without an API key", async () => {
      const result = await deploy(["web"], { COSMONER_PROJECT_ID: "proj-1" });

      expect(result.code).toBe(2);
      expect(result.stderr).toContain("COSMONER_API_KEY");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("exits 2 without a project", async () => {
      expect((await deploy(["web"], { COSMONER_API_KEY: "key-123" })).code).toBe(2);
    });

    it("exits 2 without an app", async () => {
      expect((await deploy([])).code).toBe(2);
    });

    it("exits 2 for a tag and a digest together", async () => {
      expect((await deploy(["web", "--tag", "v2", "--digest", "ab".repeat(32)])).code).toBe(2);
    });

    it("exits 2 for a tag Docker would not accept", async () => {
      expect((await deploy(["web", "--tag", "feature/login"])).code).toBe(2);
    });

    it("exits 2 for a malformed digest", async () => {
      expect((await deploy(["web", "--digest", "abc"])).code).toBe(2);
    });

    it("exits 2 for a timeout that is not a whole number", async () => {
      expect((await deploy(["web", "--timeout", "1.5"])).code).toBe(2);
    });
  });
});
