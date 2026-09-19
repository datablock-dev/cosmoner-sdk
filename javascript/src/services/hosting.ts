/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Hosting service namespace — shared web hosting sites and how to reach their files. */

import { resolveProjectId, type ResolvedConfig } from "../config";
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
}
