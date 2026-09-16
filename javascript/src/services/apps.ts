/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Apps service namespace — finding apps and rolling image apps onto a new image. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** Lifecycle state of an app as a whole. */
export type AppStatus = "DEPLOYING" | "RUNNING" | "STOPPED" | "ERROR" | "TERMINATED";

/** What a registry push does to an image app. */
export type ImageDeployPolicy = "TAG" | "NEWEST" | "MANUAL";

/**
 * An app as the API lists it.
 *
 * Only the fields a deploy script is likely to read are typed; the API returns
 * more, and they are present on the object at runtime.
 */
export interface App {
  id: string;
  name: string;
  subdomain: string;
  status: AppStatus;
  url: string | null;
  /** Set for apps built from a repository, null for image apps. */
  gitRepo: string | null;
  /** The image an image app runs, null for apps built from a repository. */
  containerImage: string | null;
  imageDeployPolicy: ImageDeployPolicy;
  createdAt: string;
  updatedAt: string;
}

/** Phase of one deployment. */
export type DeploymentPhase =
  | "PENDING"
  | "BUILDING"
  | "DEPLOYING"
  | "ACTIVE"
  | "ERROR"
  | "CANCELED"
  | "SUPERSEDED";

/** Phases after which a deployment will not change again. */
export const FINISHED_DEPLOYMENT_PHASES: readonly DeploymentPhase[] = [
  "ACTIVE",
  "ERROR",
  "CANCELED",
  "SUPERSEDED",
];

/** One deployment of an app. */
export interface AppDeployment {
  id: string;
  phase: DeploymentPhase;
  /** Why it happened, e.g. "registry push" or "api deploy". */
  cause: string | null;
  /** The image reference that was deployed. */
  imageRef: string | null;
  imageDigest: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Options accepted by every method, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/**
 * Arguments accepted by `client.apps.deploy()`.
 *
 * Pass `tag` or `digest` to roll onto that image from the repository the app
 * already pulls from, or neither to re-resolve the image the app names now.
 */
export interface DeployAppParams extends ProjectScopedParams {
  tag?: string;
  /** `sha256:` followed by 64 hex characters. */
  digest?: string;
}

/** Options accepted by `client.apps.waitForDeployment()`. */
export interface WaitForDeploymentParams extends ProjectScopedParams {
  /** Milliseconds between polls. Defaults to 3s. */
  interval?: number;
  /** Milliseconds to wait in total before giving up. Defaults to 10 minutes. */
  timeout?: number;
  /** Called with every poll result, including the last. */
  onPoll?: (deployment: AppDeployment) => void;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListAppsResponse = Envelope<App[]>;
export type DeployAppResponse = Envelope<AppDeployment>;
export type GetDeploymentResponse = Envelope<AppDeployment>;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

// Docker's tag grammar and the digest form, matching what the API accepts, so a
// malformed value fails before it spends a request against the deploy budget.
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** App lookup and image deploy operations for a project. */
export class AppsService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/apps`;
  }

  /** Lists every app in the project, newest first. */
  async list(params: ProjectScopedParams = {}): Promise<ListAppsResponse> {
    return this.transport.request<ListAppsResponse>("GET", this.basePath(params.projectId));
  }

  /**
   * Starts deploying an image app and returns the deployment without waiting.
   *
   * Only image apps pulling from a Cosmoner registry can be deployed this way;
   * the API rejects apps built from a repository. Pair with
   * `waitForDeployment()` to learn whether the rollout succeeded.
   */
  async deploy(appId: string, params: DeployAppParams = {}): Promise<DeployAppResponse> {
    if (!appId) throw new Error("appId is required");
    if (params.tag && params.digest) throw new Error("Pass either tag or digest, not both");
    if (params.tag !== undefined && !TAG_PATTERN.test(params.tag)) {
      throw new Error(`Invalid image tag "${params.tag}"`);
    }
    if (params.digest !== undefined && !DIGEST_PATTERN.test(params.digest)) {
      throw new Error("digest must be sha256:<64 hex characters>");
    }

    return this.transport.request<DeployAppResponse>(
      "POST",
      `${this.basePath(params.projectId)}/${appId}/deployments`,
      { body: { tag: params.tag, digest: params.digest } }
    );
  }

  /** Fetches one deployment's current phase. */
  async getDeployment(
    appId: string,
    deploymentId: string,
    params: ProjectScopedParams = {}
  ): Promise<GetDeploymentResponse> {
    if (!appId) throw new Error("appId is required");
    if (!deploymentId) throw new Error("deploymentId is required");

    return this.transport.request<GetDeploymentResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${appId}/deployments/${deploymentId}`
    );
  }

  /**
   * Polls a deployment until it finishes, and returns it in its final phase.
   *
   * Resolves for every finished phase, failures included — check `phase` for
   * `ACTIVE`. Rejects only when the request fails or `timeout` passes first,
   * in which case the deployment keeps going server-side.
   */
  async waitForDeployment(
    appId: string,
    deploymentId: string,
    params: WaitForDeploymentParams = {}
  ): Promise<AppDeployment> {
    const interval = params.interval ?? DEFAULT_POLL_INTERVAL_MS;
    const timeout = params.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
    if (interval <= 0) throw new Error("interval must be greater than 0");
    if (timeout <= 0) throw new Error("timeout must be greater than 0");

    const deadline = Date.now() + timeout;

    for (;;) {
      const { data } = await this.getDeployment(appId, deploymentId, params);
      params.onPoll?.(data);
      if (FINISHED_DEPLOYMENT_PHASES.includes(data.phase)) return data;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Deployment ${deploymentId} was still ${data.phase} after ${Math.round(timeout / 1000)}s`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)));
    }
  }
}
