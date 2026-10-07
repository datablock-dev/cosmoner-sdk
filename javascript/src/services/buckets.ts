/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Buckets service namespace — a project's object storage buckets. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** A bucket as the API lists it. Its access keys are never part of a listing. */
export interface Bucket {
  id: string;
  name: string;
  provider: string;
  region: string;
  endpoint: string | null;
  publicAccess: boolean;
  versioning: boolean;
  status: "CREATING" | "ACTIVE" | "SUSPENDED" | "DELETING";
  tier: string;
  cdnEnabled: boolean;
  cdnDomain: string | null;
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

export type ListBucketsResponse = Envelope<Bucket[]>;

/** Read operations on a project's buckets. The API has no single-bucket read. */
export class BucketsService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Lists every bucket in the project. */
  async list(params: ProjectScopedParams = {}): Promise<ListBucketsResponse> {
    return this.transport.request<ListBucketsResponse>(
      "GET",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/storage/object-storage`
    );
  }
}
