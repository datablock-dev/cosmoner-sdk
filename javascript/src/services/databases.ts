/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Databases service namespace — a project's dedicated and shared databases. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** One database of any kind, as the project overview lists it. */
export interface DatabaseSummary {
  kind: "DEDICATED" | "LEGACY_POOLED";
  id: string;
  name: string;
  engine: string;
  version: string | null;
  region: string;
  status: string;
  /** The size of a dedicated database, or the tier of a shared one. */
  plan: string;
  createdAt: string;
  dedicated?: { numNodes: number; storageGb: number | null };
  pooled?: { maxConnections: number; storageLimitMb: number };
}

/** A dedicated database. The API returns more; the rest are present at runtime. */
export interface DedicatedDatabase {
  id: string;
  name: string;
  engine: string;
  version: string | null;
  provider: string;
  region: string;
  size: string;
  numNodes: number;
  storageGb: number | null;
  status: string;
  host: string | null;
  port: number | null;
  defaultDb: string | null;
  defaultUser: string | null;
  createdAt: string;
}

/** A dedicated database read on its own. */
export interface DedicatedDatabaseDetail extends DedicatedDatabase {
  /**
   * A full connection URI, **including the password**. Always present once
   * the database is online, and readable with only `databases:read`, so
   * guard the key accordingly.
   */
  connectionUri: string | null;
}

/** A database on the shared cluster. No password is ever returned for one. */
export interface SharedDatabase {
  id: string;
  clusterId: string;
  clusterName: string;
  dbName: string;
  dbUser: string;
  host: string;
  port: number;
  region: string;
  poolName: string | null;
  poolPort: number | null;
  poolMode: string;
  status: string;
  tier: string;
  maxConnections: number;
  storageLimitMb: number;
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

export type ListDatabasesResponse = Envelope<DatabaseSummary[]>;
export type ListDedicatedDatabasesResponse = Envelope<DedicatedDatabase[]>;
export type GetDedicatedDatabaseResponse = Envelope<DedicatedDatabaseDetail>;
export type ListSharedDatabasesResponse = Envelope<SharedDatabase[]>;
export type GetSharedDatabaseResponse = Envelope<SharedDatabase>;

export type DeleteDatabaseResponse = Envelope<Record<string, never>>;

/** Read operations on a project's databases. */
export class DatabasesService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/databases`;
  }

  /** Lists every database in the project, of every kind, newest first. */
  async list(params: ProjectScopedParams = {}): Promise<ListDatabasesResponse> {
    return this.transport.request<ListDatabasesResponse>("GET", this.basePath(params.projectId));
  }

  /** Lists the project's dedicated databases. */
  async listDedicated(params: ProjectScopedParams = {}): Promise<ListDedicatedDatabasesResponse> {
    return this.transport.request<ListDedicatedDatabasesResponse>("GET", `${this.basePath(params.projectId)}/dedicated`);
  }

  /**
   * Fetches one dedicated database. Its `connectionUri` carries the password;
   * see {@link DedicatedDatabaseDetail}.
   */
  async getDedicated(databaseId: string, params: ProjectScopedParams = {}): Promise<GetDedicatedDatabaseResponse> {
    if (!databaseId) throw new Error("databaseId is required");
    return this.transport.request<GetDedicatedDatabaseResponse>(
      "GET",
      `${this.basePath(params.projectId)}/dedicated/${databaseId}`
    );
  }

  /** Lists the project's databases on the shared cluster. */
  async listShared(params: ProjectScopedParams = {}): Promise<ListSharedDatabasesResponse> {
    return this.transport.request<ListSharedDatabasesResponse>("GET", `${this.basePath(params.projectId)}/shared`);
  }

  /** Fetches one database on the shared cluster. */
  async getShared(tenantId: string, params: ProjectScopedParams = {}): Promise<GetSharedDatabaseResponse> {
    if (!tenantId) throw new Error("tenantId is required");
    return this.transport.request<GetSharedDatabaseResponse>("GET", `${this.basePath(params.projectId)}/shared/${tenantId}`);
  }

  /** Permanently deletes a dedicated database cluster and its data, and stops its billing. */
  async deleteDedicated(databaseId: string, params: ProjectScopedParams = {}): Promise<DeleteDatabaseResponse> {
    if (!databaseId) throw new Error("databaseId is required");
    return this.transport.request<DeleteDatabaseResponse>(
      "DELETE",
      `${this.basePath(params.projectId)}/dedicated/${databaseId}`
    );
  }

  /** Permanently deletes a shared database and its data, and stops its billing. */
  async deleteShared(tenantId: string, params: ProjectScopedParams = {}): Promise<DeleteDatabaseResponse> {
    if (!tenantId) throw new Error("tenantId is required");
    return this.transport.request<DeleteDatabaseResponse>(
      "DELETE",
      `${this.basePath(params.projectId)}/shared/${tenantId}`
    );
  }
}
