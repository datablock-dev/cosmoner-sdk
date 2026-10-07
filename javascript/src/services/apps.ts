/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Apps service namespace — finding apps and rolling image apps onto a new image. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { CheckoutPreview, PlanChangePreview } from "./preview";
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

/** Which log stream `logs()` reads: the image build, or the running app. */
export type AppLogType = "BUILD" | "RUN";

/** Arguments accepted by `client.apps.logs()`. */
export interface AppLogsParams extends ProjectScopedParams {
  type: AppLogType;
}

/** One line of an app's log. */
export interface AppLogLine {
  message: string;
  timestamp: string;
}

export type ListAppsResponse = Envelope<App[]>;
export type GetAppResponse = Envelope<App>;
export type AppLogsResponse = Envelope<{ lines: AppLogLine[] }>;
export type DeployAppResponse = Envelope<AppDeployment>;
export type GetDeploymentResponse = Envelope<AppDeployment>;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

// Docker's tag grammar and the digest form, matching what the API accepts, so a
// malformed value fails before it spends a request against the deploy budget.
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * The settings `client.apps.update()` can change. Every field is optional, but
 * a call must change at least one. Environment variables are left out on
 * purpose: they belong in the deployment file, and the API masks secret ones,
 * so a read-modify-write of the list would be easy to get wrong.
 */
export interface UpdateAppParams extends ProjectScopedParams {
  name?: string;
  buildCommand?: string | null;
  runCommand?: string | null;
  outputDir?: string | null;
  publicPort?: number | null;
  internalPort?: number | null;
  autoDeploy?: boolean;
  imageDeployPolicy?: ImageDeployPolicy;
  /** Refused for an app whose runtime cannot scale horizontally. */
  instances?: number;
}

export type UpdateAppResponse = Envelope<App>;
export type DeleteAppResponse = Envelope<Record<string, never>>;

/** Arguments accepted by `client.apps.createDraft()`. Pass a repository or an image. */
export interface CreateAppDraftParams extends ProjectScopedParams {
  name: string;
  /** A size slug from `client.catalog.appSizes()`. */
  size: string;
  /** A region slug from `client.catalog.appRegions()`. */
  region: string;
  appType?: "service" | "static";
  gitProvider?: "github" | "gitlab" | "bitbucket";
  /** `owner/repo`. */
  gitRepo?: string;
  gitBranch?: string;
  sourceDir?: string;
  buildStrategy?: "nixpacks" | "docker";
  buildCommand?: string;
  runCommand?: string;
  outputDir?: string;
  publicPort?: number;
  internalPort?: number;
  autoDeploy?: boolean;
  containerRegistry?: "dockerhub" | "ghcr" | "cosmoner";
  containerImage?: string;
  /** The image's listening port, as a string. */
  containerPublicPort?: string;
  imageDeployPolicy?: ImageDeployPolicy;
  instances?: number;
}

/** Arguments accepted by `client.apps.create()`. */
export interface CreateAppParams extends ProjectScopedParams {
  draftId: string;
  /** The size to bill; pass the draft's. */
  size: string;
}

/** An app's sizes, and whether it can be resized at all. */
export interface AppSizes {
  currentSize: string;
  resizable: boolean;
  sizes: Array<{
    slug: string;
    name: string;
    tierSlug: string;
    cpuType: string;
    cpus: number;
    memoryMb: number;
    bandwidthGib: number;
    priceMonthly: number;
  }>;
}

export type PreviewAppResponse = Envelope<CheckoutPreview>;
export type CreateAppDraftResponse = Envelope<{ draftId: string }>;
export type CreateAppResponse = Envelope<{ deployed: true; appId: string }>;
export type GetAppSizesResponse = Envelope<AppSizes>;
export type PreviewAppResizeResponse = Envelope<PlanChangePreview>;
export type ResizeAppResponse = Envelope<{ instanceSize: string }>;

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
   * Fetches one app by id, with its full configuration.
   *
   * Environment variables marked secret come back masked; any other
   * variable's value is returned as stored.
   */
  async get(appId: string, params: ProjectScopedParams = {}): Promise<GetAppResponse> {
    if (!appId) throw new Error("appId is required");
    return this.transport.request<GetAppResponse>("GET", `${this.basePath(params.projectId)}/${appId}`);
  }

  /** Fetches the most recent lines of an app's build or runtime log. */
  async logs(appId: string, params: AppLogsParams): Promise<AppLogsResponse> {
    if (!appId) throw new Error("appId is required");
    if (params?.type !== "BUILD" && params?.type !== "RUN") throw new Error('type must be "BUILD" or "RUN"');
    return this.transport.request<AppLogsResponse>("GET", `${this.basePath(params.projectId)}/${appId}/logs`, {
      query: { type: params.type },
    });
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

  /**
   * Changes an app's settings and applies them to the running app.
   *
   * Free: resizing, which is billed, is a separate call. The API answers 502
   * when the settings were saved but the runtime refused them.
   */
  async update(appId: string, params: UpdateAppParams): Promise<UpdateAppResponse> {
    if (!appId) throw new Error("appId is required");
    const { projectId, ...changes } = params ?? {};
    const body = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));
    if (Object.keys(body).length === 0) throw new Error("at least one change is required");
    return this.transport.request<UpdateAppResponse>("PATCH", `${this.basePath(projectId)}/${appId}`, { body });
  }

  /**
   * Permanently deletes an app: its runtime, routing, custom hostname and
   * billing, then the app itself. Its deployments go with it.
   */
  async delete(appId: string, params: ProjectScopedParams = {}): Promise<DeleteAppResponse> {
    if (!appId) throw new Error("appId is required");
    return this.transport.request<DeleteAppResponse>("DELETE", `${this.basePath(params.projectId)}/${appId}`);
  }

  /** Prices an app of a size before ordering it. `monthly` is exact; `dueToday` is an estimate once the project has a subscription. */
  async preview(params: { size: string } & ProjectScopedParams): Promise<PreviewAppResponse> {
    if (!params?.size) throw new Error("size is required");
    return this.transport.request<PreviewAppResponse>("GET", `${this.basePath(params.projectId)}/preview`, {
      query: { size: params.size },
    });
  }

  /**
   * Saves what an app should be, without creating or billing anything. The
   * draft expires after 24 hours; `create()` turns it into an app. The app
   * gets a Cosmoner subdomain.
   */
  async createDraft(params: CreateAppDraftParams): Promise<CreateAppDraftResponse> {
    if (!params?.name) throw new Error("name is required");
    if (!params.size) throw new Error("size is required");
    if (!params.region) throw new Error("region is required");
    const { projectId, ...fields } = params;
    return this.transport.request<CreateAppDraftResponse>("POST", `${this.basePath(projectId)}/draft`, {
      body: { ...fields, domainType: "cosmoner" },
    });
  }

  /**
   * Creates and deploys the app a draft describes. It starts `DEPLOYING`.
   *
   * Charges the project's saved card immediately, with a prorated invoice. It
   * is refused with 402 before anything is created when the project cannot be
   * billed.
   */
  async create(params: CreateAppParams): Promise<CreateAppResponse> {
    if (!params?.draftId) throw new Error("draftId is required");
    if (!params.size) throw new Error("size is required");
    return this.transport.request<CreateAppResponse>("POST", this.basePath(params.projectId), {
      body: { draftId: params.draftId, size: params.size },
    });
  }

  /** Lists the sizes an app can move to, and whether it can be resized at all. */
  async sizes(appId: string, params: ProjectScopedParams = {}): Promise<GetAppSizesResponse> {
    if (!appId) throw new Error("appId is required");
    return this.transport.request<GetAppSizesResponse>("GET", `${this.basePath(params.projectId)}/${appId}/sizes`);
  }

  /** Prices moving an app to another size. */
  async resizePreview(appId: string, params: { size: string } & ProjectScopedParams): Promise<PreviewAppResizeResponse> {
    if (!appId) throw new Error("appId is required");
    if (!params?.size) throw new Error("size is required");
    return this.transport.request<PreviewAppResizeResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${appId}/resize-preview`,
      { query: { size: params.size } }
    );
  }

  /** Moves an app to another size. Charges the difference to the saved card immediately. */
  async resize(appId: string, params: { size: string } & ProjectScopedParams): Promise<ResizeAppResponse> {
    if (!appId) throw new Error("appId is required");
    if (!params?.size) throw new Error("size is required");
    return this.transport.request<ResizeAppResponse>("PATCH", `${this.basePath(params.projectId)}/${appId}/size`, {
      body: { size: params.size },
    });
  }
}
