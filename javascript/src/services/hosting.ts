/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Hosting service namespace — shared web hosting sites and how to reach their files. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { CheckoutPreview } from "./preview";
import type { Transport } from "../transport";

/** Lifecycle state of a hosting site. */
export type HostingSiteStatus = "PROVISIONING" | "ACTIVE" | "SUSPENDED" | "DEPROVISIONED" | "ERROR";

/**
 * A shared hosting site as the API lists it.
 *
 * Only the fields a deploy script is likely to read are typed; the API returns
 * more, and they are present on the object at runtime.
 */
export interface HostingSite {
  id: string;
  siteName: string;
  phpVersion: string;
  /** The SFTP username, null until the site is provisioned. */
  unixUser: string | null;
  /**
   * Absolute path the platform hostname serves, e.g.
   * `/var/www/<unixUser>/<hostname>/public_html`. An SFTP login is chrooted to
   * `/var/www/<unixUser>`, so strip that prefix to get the path a client sees.
   */
  documentRoot: string | null;
  internalHostname: string | null;
  url: string | null;
  tier: string;
  sshEnabled: boolean;
  status: HostingSiteStatus;
  /** Public SFTP/SSH hostname; null when the environment has none configured. */
  sftpHost: string | null;
  sftpPort: number | null;
  createdAt: string;
}

/** A site read with `credentials: true`. */
export interface HostingSiteWithCredentials extends HostingSite {
  /** Null while the site is not ACTIVE. */
  sftpPassword: string | null;
  /** Whether the site's pod is serving right now. */
  ready: boolean;
}

/** Where and how to connect to a site's files. */
export interface HostingAccess {
  username: string | null;
  host: string | null;
  sftp: { port: number };
  ssh: { port: number; enabled: boolean };
}

/** Options accepted by every method, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/** Arguments accepted by `client.hosting.get()`. */
export interface GetHostingSiteParams extends ProjectScopedParams {
  /** Include the SFTP password. Needs only hosting:read, so guard the key accordingly. */
  credentials?: boolean;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListHostingSitesResponse = Envelope<HostingSite[]>;
export type GetHostingSiteResponse = Envelope<HostingSite & { ready: boolean }>;
export type GetHostingSiteWithCredentialsResponse = Envelope<HostingSiteWithCredentials>;
export type GetHostingAccessResponse = Envelope<HostingAccess>;

export type DeleteHostingSiteResponse = Envelope<Record<string, never>>;

/** A hosting plan. */
export type HostingTier = "STARTER" | "GROWTH" | "SCALE";

/** A hosting plan's price. `monthly` is in minor units. */
export interface HostingPrice {
  tier: HostingTier;
  monthly: number;
  currency: string;
}

/** Arguments accepted by `client.hosting.preview()`. */
export interface PreviewHostingSiteParams extends ProjectScopedParams {
  tier: HostingTier;
  /** Extra storage in 10 GB blocks, up to 50. */
  extraStorageGb?: number;
}

/** Arguments accepted by `client.hosting.create()`. */
export interface CreateHostingSiteParams extends ProjectScopedParams {
  /** 3–40 characters: a lowercase letter, then lowercase letters, digits and underscores. */
  siteName: string;
  /** Defaults to `STARTER` server-side. */
  tier?: HostingTier;
  /** `8.1`, `8.2` or `8.3`; defaults to `8.3` server-side. */
  phpVersion?: string;
  /** Creates a MySQL database with this name alongside the site. */
  database?: string;
  extraStorageGb?: number;
}

export type ListHostingPricesResponse = Envelope<HostingPrice[]>;
export type PreviewHostingSiteResponse = Envelope<CheckoutPreview>;
export type CreateHostingSiteResponse = Envelope<{
  tenantId: string;
  status: HostingSiteStatus;
  database?: { id: string; name: string; status: string };
  /** Set when the site was created but its database was not. */
  databaseError?: string;
}>;

/** Read operations on a project's shared hosting sites. */
export class HostingService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/hosting/shared`;
  }

  /** Lists every hosting site in the project that has not been deprovisioned. */
  async list(params: ProjectScopedParams = {}): Promise<ListHostingSitesResponse> {
    return this.transport.request<ListHostingSitesResponse>("GET", this.basePath(params.projectId));
  }

  /** Fetches one site, with its SFTP password when `credentials` is true. */
  async get(
    siteId: string,
    params: GetHostingSiteParams & { credentials: true }
  ): Promise<GetHostingSiteWithCredentialsResponse>;
  async get(siteId: string, params?: GetHostingSiteParams): Promise<GetHostingSiteResponse>;
  async get(
    siteId: string,
    params: GetHostingSiteParams = {}
  ): Promise<GetHostingSiteResponse | GetHostingSiteWithCredentialsResponse> {
    if (!siteId) throw new Error("siteId is required");

    return this.transport.request<GetHostingSiteResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${siteId}`,
      { query: params.credentials ? { credentials: "true" } : undefined }
    );
  }

  /** Fetches the host, port and username for SFTP and SSH. */
  async access(siteId: string, params: ProjectScopedParams = {}): Promise<GetHostingAccessResponse> {
    if (!siteId) throw new Error("siteId is required");

    return this.transport.request<GetHostingAccessResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${siteId}/access`
    );
  }

  /** Permanently deletes a hosting site with its files, databases and domains, and stops its billing. */
  async delete(siteId: string, params: ProjectScopedParams = {}): Promise<DeleteHostingSiteResponse> {
    if (!siteId) throw new Error("siteId is required");
    return this.transport.request<DeleteHostingSiteResponse>("DELETE", `${this.basePath(params.projectId)}/${siteId}`);
  }

  /** Lists hosting plans and their monthly prices. */
  async prices(params: ProjectScopedParams = {}): Promise<ListHostingPricesResponse> {
    return this.transport.request<ListHostingPricesResponse>("GET", `${this.basePath(params.projectId)}/prices`);
  }

  /** Prices a site before ordering it. `monthly` is exact; `dueToday` is an estimate once the project has a subscription. */
  async preview(params: PreviewHostingSiteParams): Promise<PreviewHostingSiteResponse> {
    if (!params?.tier) throw new Error("tier is required");
    return this.transport.request<PreviewHostingSiteResponse>("GET", `${this.basePath(params.projectId)}/preview`, {
      query: { tier: params.tier, extraStorageGb: params.extraStorageGb ?? 0 },
    });
  }

  /**
   * Orders a hosting site, and its database when one is named.
   *
   * Charges the project's saved card immediately, with a prorated invoice. It
   * is refused with 402 before anything is created when the project cannot be
   * billed.
   */
  async create(params: CreateHostingSiteParams): Promise<CreateHostingSiteResponse> {
    if (!params?.siteName) throw new Error("siteName is required");
    return this.transport.request<CreateHostingSiteResponse>("POST", this.basePath(params.projectId), {
      body: {
        siteName: params.siteName,
        tier: params.tier,
        phpVersion: params.phpVersion,
        database: params.database === undefined ? undefined : { name: params.database },
        extraStorageGb: params.extraStorageGb,
      },
    });
  }
}
