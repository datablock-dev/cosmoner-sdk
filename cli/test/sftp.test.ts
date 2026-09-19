import { describe, expect, it } from "vitest";

import { fingerprintOf, normaliseFingerprint } from "../src/sftp";

// A throwaway ed25519 key, and the fingerprint `ssh-keygen -lf` prints for it.
const KEY = "AAAAC3NzaC1lZDI1NTE5AAAAINvlryjvb5wgp30QyWrI3kKXc+OixBnVrVu6iYzQaA5Q";
const FINGERPRINT = "SHA256:Rxe8DzAKTArZyM57U1ZOafAdwpV1Hjcw8QweECIMMt8";

describe("fingerprintOf", () => {
  it("matches what ssh-keygen prints", () => {
    expect(fingerprintOf(Buffer.from(KEY, "base64"))).toBe(FINGERPRINT);
  });
});

describe("normaliseFingerprint", () => {
  it("accepts a fingerprint without its prefix, with padding or surrounding space", () => {
    const body = FINGERPRINT.slice("SHA256:".length);

    expect(normaliseFingerprint(body)).toBe(FINGERPRINT);
    expect(normaliseFingerprint(` ${FINGERPRINT}= `)).toBe(FINGERPRINT);
    expect(normaliseFingerprint(`sha256:${body}`)).toBe(FINGERPRINT);
  });
});
