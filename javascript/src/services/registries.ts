/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Registries service namespace — a project's container registries. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { CheckoutPreview } from "./preview";
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

/** A registry provider and the regions it offers. */
export interface RegistryProvider {
  value: string;
  label: string;
  description: string;
  regions: Array<{ value: string; label: string }>;
}

/** Arguments accepted by `client.registries.create()`. */
export interface CreateRegistryParams extends ProjectScopedParams {
  /** 3–33 lowercase letters, digits and hyphens; unique in the project. */
  name: string;
  /** A region from `providers()`. */
  region: string;
  /** A provider from `providers()`. Defaults to `AWS_ECR` server-side. */
  provider?: string;
}

export type PreviewRegistryResponse = Envelope<CheckoutPreview>;
export type ListRegistryProvidersResponse = Envelope<RegistryProvider[]>;
export type CreateRegistryResponse = Envelope<{ deployed: true; id: string }>;

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

  /**
   * Prices a registry's base fee before ordering it. Storage and egress are
   * metered and not included. `monthly` is exact; `dueToday` is an estimate
   * once the project has a subscription.
   */
  async preview(params: ProjectScopedParams = {}): Promise<PreviewRegistryResponse> {
    return this.transport.request<PreviewRegistryResponse>("GET", `${this.basePath(params.projectId)}/preview`);
  }

  /** Lists the providers a registry can be created with, and their regions. */
  async providers(params: ProjectScopedParams = {}): Promise<ListRegistryProvidersResponse> {
    return this.transport.request<ListRegistryProvidersResponse>("GET", `${this.basePath(params.projectId)}/providers`);
  }

  /**
   * Orders a registry. It is ready when this returns.
   *
   * Charges the project's saved card immediately, with a prorated invoice. It
   * is refused with 402 before anything is created when the project cannot be
   * billed.
   */
  async create(params: CreateRegistryParams): Promise<CreateRegistryResponse> {
    if (!params?.name) throw new Error("name is required");
    if (!params.region) throw new Error("region is required");
    return this.transport.request<CreateRegistryResponse>("POST", this.basePath(params.projectId), {
      body: { name: params.name, region: params.region, provider: params.provider },
    });
  }
}
