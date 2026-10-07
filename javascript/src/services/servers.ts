/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Servers service namespace — a project's virtual servers. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { CheckoutPreview } from "./preview";
import type { Transport } from "../transport";

export type ServerStatus = "PROVISIONING" | "RUNNING" | "STOPPED" | "ERROR" | "TERMINATED";

/** A server as the API lists it. The API returns more; the rest are present at runtime. */
export interface Server {
  id: string;
  name: string;
  type: "LAMP" | "POSTGRES";
  provider: string;
  region: string;
  instanceType: string;
  image: string;
  status: ServerStatus;
  ipAddress: string | null;
  hostname: string | null;
  phpVersion: string | null;
  pgVersion: string | null;
  pgDatabase: string | null;
  pgUsername: string | null;
  sshUser: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A server read on its own, with the SSH keys installed on it. */
export interface ServerDetail extends Server {
  sshKeys: Array<{ id: string; name: string; fingerprint: string }>;
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

export type ListServersResponse = Envelope<Server[]>;
export type GetServerResponse = Envelope<ServerDetail>;

export type DeleteServerResponse = Envelope<Record<string, never>>;

/** Arguments accepted by `client.servers.preview()`. */
export interface PreviewServerParams extends ProjectScopedParams {
  /** A size slug from `client.catalog.serverSizes()`. */
  size: string;
  /** Defaults to `digitalocean`, the only provider on sale. */
  provider?: string;
}

/** Arguments accepted by `client.servers.create()`. */
export interface CreateServerParams extends PreviewServerParams {
  /** Lowercase letters, digits and hyphens. */
  name: string;
  /** A region slug from `client.catalog.serverRegions()`. */
  region: string;
  /** A one-click image slug from `client.catalog.serverImages()`. */
  image?: string;
  /** SSH keys to install, by id. */
  sshKeyIds?: string[];
}

export type PreviewServerResponse = Envelope<CheckoutPreview>;
export type CreateServerResponse = Envelope<{ deployed: true }>;

/** Read operations on a project's servers. */
export class ServersService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/servers`;
  }

  /** Lists every server in the project that has not been terminated. */
  async list(params: ProjectScopedParams = {}): Promise<ListServersResponse> {
    return this.transport.request<ListServersResponse>("GET", this.basePath(params.projectId));
  }

  /** Fetches one server, with the SSH keys installed on it. */
  async get(serverId: string, params: ProjectScopedParams = {}): Promise<GetServerResponse> {
    if (!serverId) throw new Error("serverId is required");
    return this.transport.request<GetServerResponse>("GET", `${this.basePath(params.projectId)}/${serverId}`);
  }

  /** Permanently deletes a server and its disk, and stops its billing. */
  async delete(serverId: string, params: ProjectScopedParams = {}): Promise<DeleteServerResponse> {
    if (!serverId) throw new Error("serverId is required");
    return this.transport.request<DeleteServerResponse>("DELETE", `${this.basePath(params.projectId)}/${serverId}`);
  }

  /** Prices a server before ordering it. `monthly` is exact; `dueToday` is an estimate once the project has a subscription. */
  async preview(params: PreviewServerParams): Promise<PreviewServerResponse> {
    if (!params?.size) throw new Error("size is required");
    return this.transport.request<PreviewServerResponse>("GET", `${this.basePath(params.projectId)}/preview`, {
      query: { provider: params.provider ?? "digitalocean", slug: params.size },
    });
  }

  /**
   * Orders a server. It starts `PROVISIONING`; the response carries no id, so
   * list servers and match the name to follow it.
   *
   * Charges the project's saved card immediately, with a prorated invoice. It
   * is refused with 402 before anything is created when the project cannot be
   * billed.
   */
  async create(params: CreateServerParams): Promise<CreateServerResponse> {
    if (!params?.name) throw new Error("name is required");
    if (!params.size) throw new Error("size is required");
    if (!params.region) throw new Error("region is required");
    return this.transport.request<CreateServerResponse>("POST", this.basePath(params.projectId), {
      body: {
        name: params.name,
        slug: params.size,
        provider: params.provider ?? "digitalocean",
        region: params.region,
        template: params.image,
        sshKeyIds: params.sshKeyIds,
      },
    });
  }
}
