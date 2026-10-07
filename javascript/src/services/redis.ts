/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Redis service namespace — a project's managed Redis and Valkey databases. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** A Redis database as the API lists it. The API returns more; the rest are present at runtime. */
export interface RedisDatabase {
  id: string;
  name: string;
  provider: string;
  engine: "REDIS" | "VALKEY";
  engineVersion: string | null;
  planSlug: string;
  planType: "RAM" | "FLEX";
  memoryMb: number;
  throughputOps: number | null;
  cloudProvider: string | null;
  region: string;
  replication: boolean;
  dataPersistence: string;
  status: "CREATING" | "ACTIVE" | "ERROR" | "TERMINATED";
  host: string | null;
  port: number | null;
  createdAt: string;
}

/** A Redis database read on its own. */
export interface RedisDatabaseDetail extends RedisDatabase {
  /**
   * The plaintext password. Always present once provisioned, and readable
   * with only `redis:read`, so guard the key accordingly.
   */
  password: string | null;
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

export type ListRedisDatabasesResponse = Envelope<RedisDatabase[]>;
export type GetRedisDatabaseResponse = Envelope<RedisDatabaseDetail>;

export type DeleteRedisDatabaseResponse = Envelope<Record<string, never>>;

/** Read operations on a project's Redis databases. */
export class RedisService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/redis`;
  }

  /** Lists every Redis database in the project that has not been terminated. */
  async list(params: ProjectScopedParams = {}): Promise<ListRedisDatabasesResponse> {
    return this.transport.request<ListRedisDatabasesResponse>("GET", this.basePath(params.projectId));
  }

  /** Fetches one Redis database, with its password; see {@link RedisDatabaseDetail}. */
  async get(redisId: string, params: ProjectScopedParams = {}): Promise<GetRedisDatabaseResponse> {
    if (!redisId) throw new Error("redisId is required");
    return this.transport.request<GetRedisDatabaseResponse>("GET", `${this.basePath(params.projectId)}/${redisId}`);
  }

  /** Permanently deletes a Redis database and its data, and stops its billing. */
  async delete(redisId: string, params: ProjectScopedParams = {}): Promise<DeleteRedisDatabaseResponse> {
    if (!redisId) throw new Error("redisId is required");
    return this.transport.request<DeleteRedisDatabaseResponse>("DELETE", `${this.basePath(params.projectId)}/${redisId}`);
  }
}
