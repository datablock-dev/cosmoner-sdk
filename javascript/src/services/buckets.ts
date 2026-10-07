/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Buckets service namespace — a project's object storage buckets. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { CheckoutPreview } from "./preview";
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

export type DeleteBucketResponse = Envelope<Record<string, never>>;

/** A bucket's plan. */
export type BucketTier = "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE";

/** Arguments accepted by `client.buckets.preview()`. */
export interface PreviewBucketParams extends ProjectScopedParams {
  /** Defaults to `STARTER`. */
  tier?: BucketTier;
}

/** Arguments accepted by `client.buckets.create()`. */
export interface CreateBucketParams extends PreviewBucketParams {
  /** 3–33 lowercase letters, digits and hyphens; unique in the project. */
  name: string;
  /** An AWS region, e.g. `eu-north-1`. */
  region: string;
  publicAccess?: boolean;
  versioning?: boolean;
  /** Needs `publicAccess`. CDN traffic is metered on top of the tier. */
  cdnEnabled?: boolean;
}

export type PreviewBucketResponse = Envelope<CheckoutPreview>;
export type CreateBucketResponse = Envelope<{ deployed: true }>;

/** Read operations on a project's buckets. The API has no single-bucket read. */
export class BucketsService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Lists every bucket in the project. */
  async list(params: ProjectScopedParams = {}): Promise<ListBucketsResponse> {
    return this.transport.request<ListBucketsResponse>("GET", this.basePath(params.projectId));
  }

  /**
   * Permanently deletes a bucket with every object in it and the access
   * credentials made for it, and stops its billing.
   */
  async delete(bucketId: string, params: ProjectScopedParams = {}): Promise<DeleteBucketResponse> {
    if (!bucketId) throw new Error("bucketId is required");
    return this.transport.request<DeleteBucketResponse>("DELETE", `${this.basePath(params.projectId)}/${bucketId}`);
  }

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/storage/object-storage`;
  }

  /**
   * Prices a bucket's tier before ordering it. CDN traffic is metered and not
   * included. `monthly` is exact; `dueToday` is an estimate once the project
   * has a subscription.
   */
  async preview(params: PreviewBucketParams = {}): Promise<PreviewBucketResponse> {
    return this.transport.request<PreviewBucketResponse>("GET", `${this.basePath(params.projectId)}/preview`, {
      query: { provider: "AWS_S3", tier: params.tier ?? "STARTER" },
    });
  }

  /**
   * Orders a bucket. It is ready when this returns; names are unique, so list
   * and match the name to read it.
   *
   * Charges the project's saved card immediately, with a prorated invoice. It
   * is refused with 402 before anything is created when the project cannot be
   * billed.
   */
  async create(params: CreateBucketParams): Promise<CreateBucketResponse> {
    if (!params?.name) throw new Error("name is required");
    if (!params.region) throw new Error("region is required");
    return this.transport.request<CreateBucketResponse>("POST", this.basePath(params.projectId), {
      body: {
        name: params.name,
        provider: "AWS_S3",
        region: params.region,
        tier: params.tier,
        publicAccess: params.publicAccess,
        versioning: params.versioning,
        cdnEnabled: params.cdnEnabled,
      },
    });
  }
}
