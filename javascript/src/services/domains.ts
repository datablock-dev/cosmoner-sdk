/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Domains service namespace — a project's domains and their DNS records. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** One DNS record on a domain. */
export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
}

/** A domain as the API lists it. The API returns more; the rest are present at runtime. */
export interface Domain {
  id: string;
  name: string;
  type: "PURCHASED" | "MIGRATED" | "EXTERNAL";
  status: string;
  registrar: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  dnsRecords: DnsRecord[];
  /** The TXT record that proves ownership of an external domain; null otherwise. */
  verificationRecord: { type: "TXT"; name: string; value: string } | null;
  createdAt: string;
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

export type ListDomainsResponse = Envelope<Domain[]>;
export type GetDomainResponse = Envelope<Domain>;

/** Read operations on a project's domains. */
export class DomainsService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/domains`;
  }

  /** Lists every domain in the project, with its DNS records. */
  async list(params: ProjectScopedParams = {}): Promise<ListDomainsResponse> {
    return this.transport.request<ListDomainsResponse>("GET", this.basePath(params.projectId));
  }

  /** Fetches one domain by id or by name, e.g. `example.com`. */
  async get(domain: string, params: ProjectScopedParams = {}): Promise<GetDomainResponse> {
    if (!domain) throw new Error("domain is required");
    return this.transport.request<GetDomainResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${encodeURIComponent(domain)}`
    );
  }
}
