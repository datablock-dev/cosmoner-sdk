/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/**
 * Hosting service namespace — shared web hosting sites, how to reach their
 * files, the site image they run and whether they can send email.
 */

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
  /** One of the offered PHP versions; the API owns that list and picks a default when left out. */
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

/** One build of the site image. */
export interface HostingImageBuild {
  phpVersion: string;
  /**
   * The build's dated tag, e.g. `8.4-20261025`. Null for a site created before
   * images were pinned that has not been updated since.
   */
  tag: string | null;
  /** The build's image digest, `sha256:…`. Null exactly when `tag` is. */
  digest: string | null;
}

/** A newer patched build of the site's PHP version. */
export interface HostingImageUpdate {
  phpVersion: string;
  tag: string;
  digest: string;
  /** When the build was made, when known. */
  builtAt: string | null;
  /** The build fixes a vulnerability rated critical. */
  critical: boolean;
  /** The build fixes a vulnerability known to be exploited. */
  knownExploited: boolean;
  /** The critical or known-exploited vulnerabilities it fixes, by CVE id, when known. */
  cves: string[];
  /** The PHP release inside the build, e.g. `8.4.28`, when known. */
  phpPatch: string | null;
  /** The build carries a newer PHP release than the site runs; PHP's own security fixes show up here rather than in `cves`. */
  phpRelease: boolean;
}

/** Which build of the site image a site runs, what it can update to, and what it can roll back to. */
export interface HostingImageStatus {
  /** The build the site runs. It changes only through an update, a rollback, a PHP version change or a forced security update. */
  current: HostingImageBuild;
  /** When the current build was applied. Null before the site's first change. */
  updatedAt: string | null;
  /** A newer patched build of the site's PHP version, or null when the site is up to date. */
  update: HostingImageUpdate | null;
  /**
   * Set when the update fixes a critical or known-exploited vulnerability; it
   * is then applied automatically during the night after `deadline`.
   */
  forcedUpdate: { deadline: string } | null;
  /** The build the site ran before its last change, while `until` has not passed. */
  rollback: (HostingImageBuild & { until: string }) | null;
  php: {
    version: string;
    /** The last day the version receives security fixes, as `YYYY-MM-DD`. */
    securitySupportEnds: string | null;
    /** No longer offered for new sites; the site should be upgraded. */
    deprecated: boolean;
    /** The versions `setPhpVersion()` accepts. */
    offered: string[];
  };
}

/** Whether a site's PHP `mail()` can send, and as whom. */
export interface HostingMailStatus {
  /** Whether sites in this environment can send email at all. When false, `enableMail()` answers 503. */
  available: boolean;
  /** Whether the site's `mail()` sends. While false it returns `false`. */
  enabled: boolean;
  /** The address the site sends as. Null while email is off. */
  fromAddress: string | null;
  /** The SMTP credential the site sends with, listed under the project's email domains. Null while email is off. */
  credentialId: string | null;
  /** The email domain of that credential. Null while email is off. */
  emailDomainId: string | null;
  /** The project's verified email domains the site can send from. */
  domains: Array<{ id: string; name: string }>;
}

/** Arguments accepted by `client.hosting.setPhpVersion()`. */
export interface SetHostingPhpVersionParams extends ProjectScopedParams {
  /** One of `php.offered` from `image()`. */
  phpVersion: string;
}

/** Arguments accepted by `client.hosting.enableMail()`. */
export interface EnableHostingMailParams extends ProjectScopedParams {
  /** A verified email domain of the project, from `mail()` or `client.email.listDomains()`. */
  emailDomainId: string;
  /** The part before the @ of the address the site sends as, e.g. `wordpress`. */
  localPart: string;
}

/** Every image route answers with the site's image status as it stands afterwards. */
export type HostingImageStatusResponse = Envelope<HostingImageStatus>;
/** Every mail route answers with the site's mail status as it stands afterwards. */
export type HostingMailStatusResponse = Envelope<HostingMailStatus>;

/** Operations on a project's shared hosting sites. */
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

  /**
   * Reads which build of the site image a site runs, the patched build it can
   * update to, whether that update will be applied automatically and when,
   * what it can roll back to, and where its PHP version stands.
   */
  async image(siteId: string, params: ProjectScopedParams = {}): Promise<HostingImageStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    return this.transport.request<HostingImageStatusResponse>("GET", `${this.basePath(params.projectId)}/${siteId}/image`);
  }

  /**
   * Moves a site to the newest patched build of its PHP version, the `update`
   * in `image()`. The site restarts before this answers, which interrupts it
   * for a few seconds; `rollbackImage()` restores the previous build for 7 days.
   * Answers 409 when the site already runs the newest build.
   */
  async updateImage(siteId: string, params: ProjectScopedParams = {}): Promise<HostingImageStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    return this.transport.request<HostingImageStatusResponse>("POST", `${this.basePath(params.projectId)}/${siteId}/image/update`);
  }

  /**
   * Returns a site to the build it ran before its last update or PHP version
   * change, PHP version included, until `rollback.until` in `image()`. The site
   * restarts before this answers. A rollback cannot itself be rolled back, and
   * rolling back a forced security update only postpones it.
   */
  async rollbackImage(siteId: string, params: ProjectScopedParams = {}): Promise<HostingImageStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    return this.transport.request<HostingImageStatusResponse>("POST", `${this.basePath(params.projectId)}/${siteId}/image/rollback`);
  }

  /**
   * Moves a site to another PHP version, onto its newest patched build. Only
   * the versions in `php.offered` from `image()` are accepted; the API owns
   * that list. The site restarts before this answers, and `rollbackImage()`
   * restores the previous version for 7 days.
   */
  async setPhpVersion(siteId: string, params: SetHostingPhpVersionParams): Promise<HostingImageStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    if (!params?.phpVersion) throw new Error("phpVersion is required");
    return this.transport.request<HostingImageStatusResponse>("PATCH", `${this.basePath(params.projectId)}/${siteId}/php-version`, {
      body: { phpVersion: params.phpVersion },
    });
  }

  /** Reads whether a site's PHP `mail()` can send, the address it sends as, and the domains it could send from. */
  async mail(siteId: string, params: ProjectScopedParams = {}): Promise<HostingMailStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    return this.transport.request<HostingMailStatusResponse>("GET", `${this.basePath(params.projectId)}/${siteId}/mail`);
  }

  /**
   * Lets a site's PHP `mail()` send as `<localPart>@<domain>`, through a new
   * SMTP credential on the verified email domain `emailDomainId`. Every email
   * the site sends is billed on the project's email plan. Sent again with
   * another address, it replaces the site's credential. Needs `email:write` as
   * well as `hosting:write`.
   */
  async enableMail(siteId: string, params: EnableHostingMailParams): Promise<HostingMailStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    if (!params?.emailDomainId) throw new Error("emailDomainId is required");
    if (!params.localPart) throw new Error("localPart is required");
    return this.transport.request<HostingMailStatusResponse>("PUT", `${this.basePath(params.projectId)}/${siteId}/mail`, {
      body: { emailDomainId: params.emailDomainId, localPart: params.localPart },
    });
  }

  /**
   * Stops a site sending email and deletes its SMTP credential; afterwards
   * `mail()` returns `false`. Needs `email:write` as well as `hosting:write`.
   */
  async disableMail(siteId: string, params: ProjectScopedParams = {}): Promise<HostingMailStatusResponse> {
    if (!siteId) throw new Error("siteId is required");
    return this.transport.request<HostingMailStatusResponse>("DELETE", `${this.basePath(params.projectId)}/${siteId}/mail`);
  }
}
