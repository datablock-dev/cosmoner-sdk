import { createHmac } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  constructEvent,
  DEFAULT_TOLERANCE_SECONDS,
  SIGNATURE_HEADER,
  verifyWebhookSignature,
  WebhookSignatureError,
} from "../index";

const SECRET = "whsec_0123456789abcdef";
const BODY = JSON.stringify({
  id: "dlv_1",
  type: "email.delivered",
  createdAt: "2026-08-08T12:00:00.000Z",
  data: { messageId: "msg-1" },
});

/** Builds the header the platform would send for a body at a given time. */
function sign(body: string, secret = SECRET, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${v1}`;
}

describe("verifyWebhookSignature", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a signature produced with the same secret", () => {
    expect(
      verifyWebhookSignature({ payload: BODY, signature: sign(BODY), secret: SECRET })
    ).toBe(true);
  });

  it("accepts a raw body passed as a Buffer", () => {
    expect(
      verifyWebhookSignature({
        payload: Buffer.from(BODY, "utf8"),
        signature: sign(BODY),
        secret: SECRET,
      })
    ).toBe(true);
  });

  it("rejects a body modified after signing", () => {
    const tampered = BODY.replace("msg-1", "msg-2");

    expect(
      verifyWebhookSignature({ payload: tampered, signature: sign(BODY), secret: SECRET })
    ).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sign(BODY, "whsec_someone_elses_key"),
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejects a signature older than the tolerance window", () => {
    const stale = Math.floor(Date.now() / 1000) - (DEFAULT_TOLERANCE_SECONDS + 60);

    expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sign(BODY, SECRET, stale),
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejects a timestamp far in the future", () => {
    const future = Math.floor(Date.now() / 1000) + (DEFAULT_TOLERANCE_SECONDS + 60);

    expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sign(BODY, SECRET, future),
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("accepts a stale signature when the age check is disabled", () => {
    const stale = Math.floor(Date.now() / 1000) - 86_400;

    expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sign(BODY, SECRET, stale),
        secret: SECRET,
        toleranceSeconds: 0,
      })
    ).toBe(true);
  });

  it("honours a custom tolerance", () => {
    const stale = Math.floor(Date.now() / 1000) - 100;
    const params = { payload: BODY, signature: sign(BODY, SECRET, stale), secret: SECRET };

    expect(verifyWebhookSignature({ ...params, toleranceSeconds: 60 })).toBe(false);
    expect(verifyWebhookSignature({ ...params, toleranceSeconds: 300 })).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["missing v1", "t=1754654400"],
    ["missing timestamp", "v1=abc123"],
    ["non-numeric timestamp", "t=not-a-number,v1=abc123"],
    ["unstructured", "just-a-hex-digest"],
  ])("rejects a %s signature header", (_label, signature) => {
    expect(verifyWebhookSignature({ payload: BODY, signature, secret: SECRET })).toBe(false);
  });

  it("rejects a v1 digest of the wrong length without throwing", () => {
    // timingSafeEqual throws on length mismatch, so this must be caught before.
    expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejects an empty secret", () => {
    expect(verifyWebhookSignature({ payload: BODY, signature: sign(BODY), secret: "" })).toBe(
      false
    );
  });

  it("verifies a payload signed exactly at the tolerance boundary", () => {
    const now = 1_754_654_400_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const boundary = Math.floor(now / 1000) - DEFAULT_TOLERANCE_SECONDS;

    expect(
      verifyWebhookSignature({
        payload: BODY,
        signature: sign(BODY, SECRET, boundary),
        secret: SECRET,
      })
    ).toBe(true);
  });
});

describe("constructEvent", () => {
  it("returns the parsed envelope for a valid signature", () => {
    const event = constructEvent<{ messageId: string }>({
      payload: BODY,
      signature: sign(BODY),
      secret: SECRET,
    });

    expect(event).toEqual({
      id: "dlv_1",
      type: "email.delivered",
      createdAt: "2026-08-08T12:00:00.000Z",
      data: { messageId: "msg-1" },
    });
    expect(event.data.messageId).toBe("msg-1");
  });

  it("throws WebhookSignatureError when the signature does not match", () => {
    expect(() =>
      constructEvent({ payload: BODY, signature: sign("something else"), secret: SECRET })
    ).toThrow(WebhookSignatureError);
  });

  it("names the header when it is missing entirely", () => {
    expect(() => constructEvent({ payload: BODY, signature: "", secret: SECRET })).toThrow(
      SIGNATURE_HEADER
    );
  });

  it("distinguishes a malformed header from a failed comparison", () => {
    expect(() =>
      constructEvent({ payload: BODY, signature: "garbage", secret: SECRET })
    ).toThrow(/Malformed/);
  });

  it("throws when the secret is missing", () => {
    expect(() => constructEvent({ payload: BODY, signature: sign(BODY), secret: "" })).toThrow(
      "Signing secret is required"
    );
  });

  it("throws when a correctly signed body is not JSON", () => {
    const notJson = "this is signed but not json";

    expect(() =>
      constructEvent({ payload: notJson, signature: sign(notJson), secret: SECRET })
    ).toThrow("not valid JSON");
  });

  it("carries the SDK error code", () => {
    try {
      constructEvent({ payload: BODY, signature: "garbage", secret: SECRET });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WebhookSignatureError).code).toBe("WEBHOOK_SIGNATURE_INVALID");
    }
  });
});
