/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** IAM service namespace — a project's storage and registry access keys. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/**
 * One access credential. Only the key id is ever returned; the secret half is
 * shown once, when the credential is created.
 */
export interface IamCredential {
  iamUserName: string;
  label: string | null;
  accessKeyId: string;
  createdAt: string;
  origin: "project" | "registry" | "bucket";
  registry: {
    access: "pull" | "push";
    allRepositories: boolean;
    repositories: Array<{ repositoryId: string; repositoryName: string; registryId: string | null }>;
  } | null;
  storage: {
    access: "read" | "write";
    allBuckets: boolean;
    buckets: Array<{ bucketId: string; bucketName: string }>;
  } | null;
}

/** The project's credentials, and any it could not read. */
export interface IamCredentialList {
  credentials: IamCredential[];
  /** Problems reading some credentials; the rest are still listed. */
  errors: string[];
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

export type ListIamCredentialsResponse = Envelope<IamCredentialList>;
export type GetIamCredentialResponse = Envelope<IamCredential>;


/** What a new credential may do in object storage. */
export interface IamStorageGrant {
  access: "read" | "write";
  /** Buckets it reaches, by id. Omitted or empty: every bucket, including ones created later. */
  bucketIds?: string[];
}

/** What a new credential may do in the container registry. */
export interface IamRegistryGrant {
  access: "pull" | "push";
  /** Repositories it reaches, by id. Omitted or empty: every repository, including ones created later. */
  repositoryIds?: string[];
}

/** Arguments accepted by `client.iam.create()`. At least one of `storage` and `registry` is required. */
export interface CreateIamCredentialParams extends ProjectScopedParams {
  /** 1–20 characters; it becomes part of the IAM user name. */
  label: string;
  storage?: IamStorageGrant;
  registry?: IamRegistryGrant;
}

/** A new credential, with its secret key — returned this once. */
export interface NewIamCredential {
  iamUserName: string;
  label: string;
  accessKeyId: string;
  /** Store it now: the API keeps no copy, and no later read returns it. */
  secretAccessKey: string;
  createdAt: string;
  origin: "project";
  storage: { access: "read" | "write"; allBuckets: boolean; buckets: Array<{ bucketId: string; bucketName: string }> } | null;
  registry: {
    access: "pull" | "push";
    allRepositories: boolean;
    repositories: Array<{ repositoryId: string; repositoryName: string; registryId: string }>;
  } | null;
}

export type CreateIamCredentialResponse = Envelope<NewIamCredential>;

/** Read operations on a project's access credentials. */
export class IamService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/iam`;
  }

  /** Lists every access credential in the project, newest first. */
  async list(params: ProjectScopedParams = {}): Promise<ListIamCredentialsResponse> {
    return this.transport.request<ListIamCredentialsResponse>("GET", this.basePath(params.projectId));
  }

  /** Fetches one credential by its IAM user name. */
  async get(iamUserName: string, params: ProjectScopedParams = {}): Promise<GetIamCredentialResponse> {
    if (!iamUserName) throw new Error("iamUserName is required");
    return this.transport.request<GetIamCredentialResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${encodeURIComponent(iamUserName)}`
    );
  }

  /**
   * Deletes an IAM user and its access keys, by user name. Anything using the
   * keys stops working. The API answers 204, so there is nothing to return.
   */
  async delete(iamUserName: string, params: ProjectScopedParams = {}): Promise<void> {
    if (!iamUserName) throw new Error("iamUserName is required");
    await this.transport.request<void>("DELETE", `${this.basePath(params.projectId)}/${encodeURIComponent(iamUserName)}`);
  }

  /**
   * Creates an access key for object storage, the container registry, or both.
   * The response holds `secretAccessKey` this once: the API keeps no copy, and
   * no later read returns it.
   */
  async create(params: CreateIamCredentialParams): Promise<CreateIamCredentialResponse> {
    if (!params?.label) throw new Error("label is required");
    if (!params.storage && !params.registry) throw new Error("storage or registry is required");
    return this.transport.request<CreateIamCredentialResponse>("POST", this.basePath(params.projectId), {
      body: { label: params.label, storage: params.storage, registry: params.registry },
    });
  }
}
