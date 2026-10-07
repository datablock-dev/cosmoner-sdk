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
}
