import { describe, expect, it } from "vitest";

import { HIDDEN, redact } from "../../src/read/redact";

describe("redact", () => {
  it("hides credential fields at any depth, whatever their exact name", () => {
    const out = redact({
      password: "p",
      nested: { sftpPassword: "p", secretAccessKey: "k", api_key: "k", token: "t", connectionUri: "u", dsn: "d" },
      list: [{ privateKey: "k" }],
    });

    expect(out).toEqual({
      password: HIDDEN,
      nested: { sftpPassword: HIDDEN, secretAccessKey: HIDDEN, api_key: HIDDEN, token: HIDDEN, connectionUri: HIDDEN, dsn: HIDDEN },
      list: [{ privateKey: HIDDEN }],
    });
  });

  it("masks a password inside a URL under any field name", () => {
    const out = redact({ uri: "postgresql://app:s3cr3t@db.internal:5432/app", note: "see redis://:pw@cache:6379" });

    expect(out.uri).toBe(`postgresql://app:${HIDDEN}@db.internal:5432/app`);
    expect(out.note).toBe(`see redis://:${HIDDEN}@cache:6379`);
    expect(JSON.stringify(out)).not.toContain("s3cr3t");
    expect(JSON.stringify(out)).not.toContain(":pw@");
  });

  it("leaves a URL without a password alone", () => {
    const input = { url: "https://user@example.com/path", site: "https://shop.example.com:8443/a:b" };

    expect(redact(input)).toEqual(input);
  });

  it("keeps flags, counts and empty values, which say nothing secret", () => {
    const input = { hasPassword: true, secretCount: 3, password: null, token: "", name: "web", host: "db.internal" };

    expect(redact(input)).toEqual(input);
  });

  it("does not modify its input", () => {
    const input = { password: "p" };
    redact(input);
    expect(input.password).toBe("p");
  });
});
