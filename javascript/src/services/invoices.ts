/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Invoices service namespace — the invoices issued to a project. Read-only. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** Where an invoice is in its lifecycle. */
export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

/** An invoice issued to the project. */
export interface Invoice {
  /** Opaque id. Also the cursor for the next page of `list()`. */
  id: string;
  /** The number printed on the invoice. Null while it is a draft. */
  number: string | null;
  /** ISO 8601 date-time. */
  created: string;
  /** Amount due, in minor units of `currency`: `4900` is USD 49.00. */
  amountDue: number;
  /** Upper-case ISO 4217 code, e.g. `USD`. */
  currency: string;
  status: InvoiceStatus | null;
  /** A page showing the invoice, where an open one can be paid. Null while it is a draft. */
  hostedInvoiceUrl: string | null;
  /** A direct download of the invoice as a PDF. Null while it is a draft. */
  invoicePdfUrl: string | null;
  /** Always null: the project is the one the request named. */
  project: null;
}

/** One page of invoices, newest first. */
export interface InvoicePage {
  data: Invoice[];
  hasMore: boolean;
  /** Pass as `startingAfter` for the next page. Null on the last page. */
  nextCursor: string | null;
}

/** Options accepted by every method, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

/** Filters shared by `list()` and `export()`. */
export interface InvoiceFilterParams extends ProjectScopedParams {
  status?: InvoiceStatus;
  /** Inclusive lower bound on the invoice date: an ISO date (`2026-01-01`) or date-time. */
  createdGte?: string;
  /** Inclusive upper bound on the invoice date: an ISO date or date-time. */
  createdLte?: string;
}

/** Arguments accepted by `client.invoices.list()`. */
export interface ListInvoicesParams extends InvoiceFilterParams {
  /** Page size, 1 to 100. The API defaults to 10. */
  limit?: number;
  /** The previous page's `nextCursor`. */
  startingAfter?: string;
}

export type ListInvoicesResponse = Envelope<InvoicePage>;
export type ExportInvoicesResponse = Envelope<Invoice[]>;
export type GetInvoiceResponse = Envelope<Invoice>;

/** A project's invoices. Needs a key with `billing:read`. */
export class InvoicesService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Lists one page of the project's invoices, newest first, at every stage. */
  async list(params: ListInvoicesParams = {}): Promise<ListInvoicesResponse> {
    return this.transport.request<ListInvoicesResponse>("GET", this.basePath(params.projectId), {
      query: { ...filterQuery(params), limit: params.limit, starting_after: params.startingAfter || undefined },
    });
  }

  /**
   * Every invoice matching the filters in one response, newest first, for
   * bookkeeping. At most 1,000: narrow the date range to reach further back.
   * Rate-limited, unlike `list()`.
   */
  async export(params: InvoiceFilterParams = {}): Promise<ExportInvoicesResponse> {
    return this.transport.request<ExportInvoicesResponse>("GET", `${this.basePath(params.projectId)}/export`, {
      query: filterQuery(params),
    });
  }

  /** Reads one invoice by the id `list()` returns. */
  async get(invoiceId: string, params: ProjectScopedParams = {}): Promise<GetInvoiceResponse> {
    if (!invoiceId) throw new Error("invoiceId is required");
    return this.transport.request<GetInvoiceResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${encodeURIComponent(invoiceId)}`
    );
  }

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/billing/invoices`;
  }
}

/** The query parameters both `list()` and `export()` send. */
function filterQuery(params: InvoiceFilterParams): Record<string, string | undefined> {
  return {
    status: params.status,
    created_gte: params.createdGte || undefined,
    created_lte: params.createdLte || undefined,
  };
}
