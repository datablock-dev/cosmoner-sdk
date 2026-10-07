/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Registries service namespace — a project's container registries. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** One repository in a registry. */
export interface RegistryRepository {
  id: string;
  name: string;
  /** The path to pull and push, e.g. `registry.cosmoner.com/acme/web`. */
  fullPath: string;
  visibility: "PRIVATE" | "PUBLIC";
}

/** A container registry. The API returns more; the rest are present at runtime. */
export interface Registry {
  id: string;
  name: string;
  provider: string;
  region: string;
  endpoint: string | null;
  status: "CREATING" | "ACTIVE" | "SUSPENDED" | "DELETING";
  namespaceName: string | null;
  repositories: RegistryRepository[];
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

export type ListRegistriesResponse = Envelope<Registry[]>;
export type GetRegistryResponse = Envelope<Registry>;

export type DeleteRegistryResponse = Envelope<Record<string, never>>;

/** Read operations on a project's container registries. */
export class RegistriesService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/storage/container-registry`;
  }

  /** Lists every registry in the project, with its repositories. */
  async list(params: ProjectScopedParams = {}): Promise<ListRegistriesResponse> {
    return this.transport.request<ListRegistriesResponse>("GET", this.basePath(params.projectId));
  }

  /** Fetches one registry, with its repositories. */
  async get(registryId: string, params: ProjectScopedParams = {}): Promise<GetRegistryResponse> {
    if (!registryId) throw new Error("registryId is required");
    return this.transport.request<GetRegistryResponse>("GET", `${this.basePath(params.projectId)}/${registryId}`);
  }

  /** Permanently deletes a registry with every repository and image in it, and stops its billing. */
  async delete(registryId: string, params: ProjectScopedParams = {}): Promise<DeleteRegistryResponse> {
    if (!registryId) throw new Error("registryId is required");
    return this.transport.request<DeleteRegistryResponse>("DELETE", `${this.basePath(params.projectId)}/${registryId}`);
  }
}
