import { describe, it, expect, vi, afterEach } from "vitest";
import { Cosmoner, CosmonerError, InsufficientScopeError, RateLimitError } from "./index";
import { errorFromResponse } from "./errors";

const DOCS_URL = "https://cosmoner.com/docs#insufficient_scope";

/** An error envelope as the API sends it, with `extra` merged into `error`. */
function envelope(extra: Record<string, unknown> = {}) {
  return {
    success: false,
    error: {
      code: "INSUFFICIENT_SCOPE",
      message: "API key does not have apps:write permission",
      ...extra,
    },
  };
}

describe("errorFromResponse docsUrl", () => {
  it("exposes the link when the API sends one", () => {
    const err = errorFromResponse(403, envelope({ docsUrl: DOCS_URL }));

    expect(err).toBeInstanceOf(InsufficientScopeError);
    expect(err.docsUrl).toBe(DOCS_URL);
  });

  it("leaves it undefined when the API sends none", () => {
    expect(errorFromResponse(403, envelope()).docsUrl).toBeUndefined();
  });

  it.each([[42], [null], [{ href: DOCS_URL }], [[DOCS_URL]]])(
    "ignores a non-string docsUrl (%j)",
    (value) => {
      expect(errorFromResponse(403, envelope({ docsUrl: value })).docsUrl).toBeUndefined();
    }
  );

  it("leaves it undefined on a body that is not an envelope", () => {
    expect(errorFromResponse(502, "<html>Bad gateway</html>").docsUrl).toBeUndefined();
  });

  it("carries the link onto a rate-limit error", () => {
    const err = errorFromResponse(429, envelope({ code: "RATE_LIMITED", docsUrl: DOCS_URL }));

    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.docsUrl).toBe(DOCS_URL);
  });

  it("does not change the message", () => {
    const err = errorFromResponse(403, envelope({ docsUrl: DOCS_URL }));

    expect(err.message).toBe("API key does not have apps:write permission");
  });
});

describe("docsUrl through the transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reaches the thrown error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(envelope({ docsUrl: DOCS_URL })), { status: 403 })
    );
    const client = new Cosmoner({
      apiKey: "key-123",
      projectId: "proj-1",
      baseUrl: "https://api.test.dev",
      maxRetries: 0,
    });

    const err: unknown = await client.apps.list().catch((caught: unknown) => caught);

    expect(err).toBeInstanceOf(CosmonerError);
    expect((err as CosmonerError).docsUrl).toBe(DOCS_URL);
  });
});
