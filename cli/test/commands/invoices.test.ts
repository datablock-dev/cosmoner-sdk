import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { run } from "../../src/cli";
import { invoicesToCsv } from "../../src/commands/invoices";

/** Drives `cosmoner invoices` through the real entry point against a mocked API. */

const API = "https://api.test.dev/v1/projects/proj-1/billing/invoices";
const ENV = {
  COSMONER_API_KEY: "key-123",
  COSMONER_PROJECT_ID: "proj-1",
  COSMONER_API_URL: "https://api.test.dev",
};

const PDF_URL = "https://files.test/in_1/pdf";

const INVOICE = {
  id: "in_1",
  number: "DB-0001",
  created: "2026-02-01T09:15:00.000Z",
  amountDue: 4900,
  currency: "USD",
  status: "paid",
  hostedInvoiceUrl: "https://files.test/in_1",
  invoicePdfUrl: PDF_URL,
  project: null,
};

const DRAFT = {
  ...INVOICE,
  id: "in_2",
  number: null,
  status: "draft",
  hostedInvoiceUrl: null,
  invoicePdfUrl: null,
};

let out: string[];
let err: string[];
let fetchSpy: ReturnType<typeof vi.spyOn>;
let workspace: string;

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A JSON response with the API's error envelope. */
function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A page of invoices, as the list route answers. */
function page(data: unknown[], nextCursor: string | null = null): Response {
  return ok({ data, hasMore: nextCursor !== null, nextCursor });
}

/** Runs `cosmoner invoices` with the given arguments. */
async function invoices(argv: string[], env: Record<string, string> = ENV) {
  const code = await run(["invoices", ...argv], workspace, false, env);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** The URL of the nth request the spy captured. */
function urlOf(index: number): string {
  return String(fetchSpy.mock.calls[index][0]);
}

beforeEach(() => {
  out = [];
  err = [];
  workspace = mkdtempSync(join(tmpdir(), "cosmoner-invoices-"));
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("invoices get", () => {
  it("lists the latest invoices as a table", async () => {
    fetchSpy.mockResolvedValueOnce(page([INVOICE, DRAFT]));

    const result = await invoices(["get"]);

    expect(result.code).toBe(0);
    expect(urlOf(0)).toBe(`${API}?limit=25`);
    const [header, first, second] = result.stdout.split("\n");
    expect(header).toMatch(/^NUMBER\s+DATE\s+STATUS\s+AMOUNT\s+ID$/);
    expect(first).toMatch(/^DB-0001\s+2026-02-01\s+paid\s+49\.00 USD\s+in_1$/);
    expect(second).toMatch(/^-\s+2026-02-01\s+draft\s+49\.00 USD\s+in_2$/);
    expect(result.stderr).toBe("");
  });

  it("passes the filters and limit to the API, and list is the same", async () => {
    fetchSpy.mockResolvedValueOnce(page([]));

    const result = await invoices(["list", "--status", "open", "--from", "2026-01-01", "--to", "2026-03-31", "--limit", "5"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No invoices.");
    const query = Object.fromEntries(new URL(urlOf(0)).searchParams);
    expect(query).toEqual({ status: "open", created_gte: "2026-01-01", created_lte: "2026-03-31", limit: "5" });
  });

  it("prints the API's objects as JSON, and says on stderr when there are more", async () => {
    fetchSpy.mockResolvedValueOnce(page([INVOICE], "in_1"));

    const result = await invoices(["get", "--format", "json", "--limit", "1"]);

    expect(JSON.parse(result.stdout)).toEqual([INVOICE]);
    expect(result.stderr).toContain("cosmoner invoices export");
  });

  it("reads one invoice by id", async () => {
    fetchSpy.mockResolvedValueOnce(ok(INVOICE));

    const result = await invoices(["get", "in_1"]);

    expect(result.code).toBe(0);
    expect(urlOf(0)).toBe(`${API}/in_1`);
    expect(result.stdout).toContain("number:  DB-0001");
    expect(result.stdout).toContain(`pdf:     ${PDF_URL}`);
  });

  it("finds one invoice by number, paging through the list", async () => {
    fetchSpy
      .mockResolvedValueOnce(page([DRAFT], "in_2"))
      .mockResolvedValueOnce(page([INVOICE]));

    const result = await invoices(["get", "DB-0001", "--format", "json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(INVOICE);
    expect(urlOf(0)).toBe(`${API}?limit=100`);
    expect(urlOf(1)).toBe(`${API}?limit=100&starting_after=in_2`);
  });

  it("falls back to the numbers when an id-shaped reference is not an id", async () => {
    fetchSpy
      .mockResolvedValueOnce(fail(404, "NOT_FOUND", "Invoice not found"))
      .mockResolvedValueOnce(page([{ ...INVOICE, number: "INV42" }]));

    const result = await invoices(["get", "INV42", "--format", "json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).number).toBe("INV42");
  });

  it("exits 1 when no invoice matches", async () => {
    fetchSpy.mockResolvedValueOnce(page([INVOICE]));

    const result = await invoices(["get", "DB-9999"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toBe('No invoice "DB-9999" in this project.');
  });

  it("exits 1 with the API's reason when the key lacks billing:read", async () => {
    fetchSpy.mockResolvedValueOnce(fail(403, "INSUFFICIENT_SCOPE", "This API key is missing the billing:read scope"));

    const result = await invoices(["get"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("INSUFFICIENT_SCOPE");
  });
});

describe("invoices export", () => {
  it("writes CSV by default", async () => {
    fetchSpy.mockResolvedValueOnce(ok([INVOICE, DRAFT]));

    const result = await invoices(["export", "--from", "2026-01-01"]);

    expect(result.code).toBe(0);
    expect(urlOf(0)).toBe(`${API}/export?created_gte=2026-01-01`);
    expect(result.stdout.split("\r\n")).toEqual([
      '"Invoice","Date","Status","Amount","Currency","Invoice URL","PDF URL"',
      `"DB-0001","2026-02-01","paid","49.00","USD","https://files.test/in_1","${PDF_URL}"`,
      '"in_2","2026-02-01","draft","49.00","USD","",""',
    ]);
  });

  it("prints the API's array with --format json", async () => {
    fetchSpy.mockResolvedValueOnce(ok([INVOICE]));

    const result = await invoices(["export", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toEqual([INVOICE]);
  });

  it("refuses --limit, which would silently cut the export short", async () => {
    const result = await invoices(["export", "--limit", "5"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--limit does not apply to cosmoner invoices export");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("invoicesToCsv", () => {
  it("guards cells a spreadsheet would read as a formula, and escapes quotes", () => {
    const [, row] = invoicesToCsv([{ ...INVOICE, number: '=HYPERLINK("x")' } as never]).split("\r\n");

    expect(row.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
  });

  it("writes amounts in the currency's own minor units", () => {
    const [, row] = invoicesToCsv([{ ...INVOICE, amountDue: 4900, currency: "JPY" } as never]).split("\r\n");

    expect(row).toContain('"4900","JPY"');
  });
});

describe("invoices download", () => {
  const PDF = new TextEncoder().encode("%PDF-1.7\n...");

  it("saves the PDF as <number>.pdf without sending the API key to the file host", async () => {
    fetchSpy.mockResolvedValueOnce(ok(INVOICE)).mockResolvedValueOnce(new Response(PDF, { status: 200 }));

    const result = await invoices(["download", "in_1"]);

    expect(result.code).toBe(0);
    const saved = join(workspace, "DB-0001.pdf");
    expect(readFileSync(saved)).toEqual(Buffer.from(PDF));
    expect(fetchSpy.mock.calls[1][0]).toBe(PDF_URL);
    expect(fetchSpy.mock.calls[1][1]).toBeUndefined();
  });

  it("writes to --out", async () => {
    fetchSpy.mockResolvedValueOnce(ok(INVOICE)).mockResolvedValueOnce(new Response(PDF, { status: 200 }));

    const result = await invoices(["download", "in_1", "--out", "q1/../invoice.pdf"]);

    expect(result.code).toBe(0);
    expect(existsSync(join(workspace, "invoice.pdf"))).toBe(true);
  });

  it("refuses to overwrite a file named with --out, before any request", async () => {
    writeFileSync(join(workspace, "invoice.pdf"), "mine");

    const result = await invoices(["download", "in_1", "--out", "invoice.pdf"]);

    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readFileSync(join(workspace, "invoice.pdf"), "utf8")).toBe("mine");
  });

  it("refuses to overwrite the default file", async () => {
    writeFileSync(join(workspace, "DB-0001.pdf"), "mine");
    fetchSpy.mockResolvedValueOnce(ok(INVOICE));

    const result = await invoices(["download", "in_1"]);

    expect(result.code).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(workspace, "DB-0001.pdf"), "utf8")).toBe("mine");
  });

  it("exits 1 for a draft, which has no PDF yet", async () => {
    fetchSpy.mockResolvedValueOnce(ok(DRAFT));

    const result = await invoices(["download", "in_2"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("still a draft");
  });

  it("never saves something that is not a PDF", async () => {
    fetchSpy
      .mockResolvedValueOnce(ok(INVOICE))
      .mockResolvedValueOnce(new Response("<html>expired</html>", { status: 200 }));

    const result = await invoices(["download", "in_1"]);

    expect(result.code).toBe(1);
    expect(existsSync(join(workspace, "DB-0001.pdf"))).toBe(false);
  });

  it("needs an invoice", async () => {
    const result = await invoices(["download"]);

    expect(result.code).toBe(2);
  });
});

describe("invoices usage", () => {
  it("rejects an unknown verb", async () => {
    const result = await invoices(["pay", "in_1"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown subcommand "cosmoner invoices pay"');
  });

  it("rejects a --limit outside the page size", async () => {
    const result = await invoices(["get", "--limit", "500"]);

    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects list filters on a single invoice", async () => {
    const result = await invoices(["get", "in_1", "--status", "paid"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--status does not apply to cosmoner invoices get <invoice>");
  });
});
