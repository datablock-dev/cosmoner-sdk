/** Verification of the HMAC signature Cosmoner sends with every webhook. */

import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookSignatureError } from "../errors";

/** Header carrying the timestamp and signature of the request body. */
export const SIGNATURE_HEADER = "x-cosmoner-signature";
/** Header carrying the delivery id, so receivers can dedupe replays. */
export const DELIVERY_ID_HEADER = "x-cosmoner-delivery-id";
/** Header carrying the event type, for routing without parsing the body. */
export const EVENT_TYPE_HEADER = "x-cosmoner-event";

/** How old a signature may be before it is rejected as a replay. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** The JSON envelope Cosmoner POSTs to an endpoint. */
export interface WebhookEvent<T = unknown> {
  id: string;
  type: string;
  createdAt: string;
  data: T;
}

/** Arguments shared by `verify` and `constructEvent`. */
export interface VerifyWebhookParams {
  /**
   * The raw request body, exactly as received.
   *
   * Passing a parsed object re-serialized with `JSON.stringify` will not
   * verify: key order and whitespace are part of what was signed.
   */
  payload: string | Buffer;
  /** Value of the `x-cosmoner-signature` header. */
  signature: string;
  /** The endpoint's signing secret, as returned when it was created. */
  secret: string;
  /** Overrides the 300s replay window. Pass 0 to skip the age check. */
  toleranceSeconds?: number;
}

/** Parsed form of the signature header. */
interface ParsedSignature {
  timestamp: number;
  v1: string;
}

/** Splits `t=<unix seconds>,v1=<hex>` into its parts, or null if malformed. */
function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts: Record<string, string> = {};
  for (const segment of header.split(",")) {
    const [key, ...rest] = segment.split("=");
    if (key) parts[key.trim()] = rest.join("=");
  }

  const timestamp = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(timestamp) || !v1) return null;

  return { timestamp, v1 };
}

/** Compares two hex digests without leaking their difference through timing. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch rather than returning false.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Recomputes the signature for a body and reports whether it matches.
 *
 * Returns false for every failure mode — malformed header, stale timestamp,
 * wrong secret — so callers that only need a yes/no do not have to catch.
 * Use `constructEvent` when the reason matters.
 */
export function verifyWebhookSignature(params: VerifyWebhookParams): boolean {
  const { payload, signature, secret } = params;
  const tolerance = params.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

  if (!signature || !secret) return false;

  const parsed = parseSignatureHeader(signature);
  if (!parsed) return false;

  if (tolerance > 0) {
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
    if (ageSeconds > tolerance) return false;
  }

  const body = typeof payload === "string" ? payload : payload.toString("utf8");
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${body}`)
    .digest("hex");

  return constantTimeEquals(expected, parsed.v1);
}

/**
 * Verifies a webhook and returns its parsed envelope.
 *
 * Throws `WebhookSignatureError` rather than returning false, so an unverified
 * payload cannot be used by accident: there is no value to read unless the
 * signature held.
 */
export function constructEvent<T = unknown>(params: VerifyWebhookParams): WebhookEvent<T> {
  if (!params.signature) {
    throw new WebhookSignatureError(`Missing ${SIGNATURE_HEADER} header`);
  }
  if (!params.secret) {
    throw new WebhookSignatureError("Signing secret is required");
  }
  if (!parseSignatureHeader(params.signature)) {
    throw new WebhookSignatureError(
      `Malformed ${SIGNATURE_HEADER} header — expected "t=<seconds>,v1=<hex>"`
    );
  }
  if (!verifyWebhookSignature(params)) {
    throw new WebhookSignatureError(
      "Webhook signature verification failed — the payload was not signed with this secret, or it is outside the replay window"
    );
  }

  const body =
    typeof params.payload === "string" ? params.payload : params.payload.toString("utf8");

  try {
    return JSON.parse(body) as WebhookEvent<T>;
  } catch {
    throw new WebhookSignatureError("Webhook payload is not valid JSON");
  }
}
