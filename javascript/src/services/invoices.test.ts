import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Cosmoner } from "../index";

const API = "https://api.test.dev";
const P = `${API}/v1/projects/proj-1/billing/invoices`;

/** A JSON response with the API's success envelope. */
function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The URL and method of the one request the spy captured. */
function sent(fetchSpy: ReturnType<typeof vi.spyOn>): { url: string; method: string } {
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method ?? "GET" };
}

const invoice = {
  id: "in_1",
  number: "DB-0001",
  created: "2026-02-01T09:15:00.000Z",
  amountDue: 4900,
  currency: "USD",
  status: "paid",
  hostedInvoiceUrl: "https://invoices.test/in_1",
  invoicePdfUrl: "https://invoices.test/in_1/pdf",
  project: null,
};

describe("InvoicesService", () => {
  let client: Cosmoner;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new Cosmoner({ apiKey: "key-123", projectId: "proj-1", baseUrl: API, maxRetries: 0 });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists a page of invoices with no query by default", async () => {
    const page = { data: [invoice], hasMore: false, nextCursor: null };
    fetchSpy.mockResolvedValueOnce(ok(page));

    const result = await client.invoices.list();

    expect(sent(fetchSpy)).toEqual({ url: P, method: "GET" });
    expect(result).toEqual({ success: true, data: page });
  });

  it("sends the filters and cursor in the API's snake_case", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ data: [], hasMore: false, nextCursor: null }));

    await client.invoices.list({
      status: "open",
      createdGte: "2026-01-01",
      createdLte: "2026-06-30",
      limit: 50,
      startingAfter: "in_9",
    });

    const url = new URL(sent(fetchSpy).url);
    expect(url.pathname).toBe("/v1/projects/proj-1/billing/invoices");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "open",
      created_gte: "2026-01-01",
      created_lte: "2026-06-30",
      limit: "50",
      starting_after: "in_9",
    });
  });

  it("honours a per-call project", async () => {
    fetchSpy.mockResolvedValueOnce(ok({ data: [], hasMore: false, nextCursor: null }));

    await client.invoices.list({ projectId: "proj-2" });

    expect(sent(fetchSpy).url).toBe(`${API}/v1/projects/proj-2/billing/invoices`);
  });

  it("exports every invoice matching the filters, without paging", async () => {
    fetchSpy.mockResolvedValueOnce(ok([invoice]));

    const result = await client.invoices.export({ status: "paid", createdGte: "2026-01-01" });

    expect(sent(fetchSpy)).toEqual({ url: `${P}/export?status=paid&created_gte=2026-01-01`, method: "GET" });
    expect(result).toEqual({ success: true, data: [invoice] });
  });

  it("reads one invoice by id", async () => {
    fetchSpy.mockResolvedValueOnce(ok(invoice));

    const result = await client.invoices.get("in_1");

    expect(sent(fetchSpy)).toEqual({ url: `${P}/in_1`, method: "GET" });
    expect(result.data.invoicePdfUrl).toBe("https://invoices.test/in_1/pdf");
  });

  it("encodes the invoice id into the path", async () => {
    fetchSpy.mockResolvedValueOnce(ok(invoice));

    await client.invoices.get("in/../x");

    expect(sent(fetchSpy).url).toBe(`${P}/in%2F..%2Fx`);
  });

  it("rejects a missing invoice id without a request", async () => {
    await expect(client.invoices.get("")).rejects.toThrow("invoiceId is required");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
