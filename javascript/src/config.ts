/** Shared, validated configuration for the client and its service namespaces. */

export const DEFAULT_BASE_URL = "https://api.cosmoner.com";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;

/** Options accepted by the `Cosmoner` constructor. */
export interface CosmonerConfig {
  apiKey: string;
  /**
   * Default project for every call. Optional — omit it and pass `projectId`
   * per method to work across projects with one client.
   */
  projectId?: string;
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30s. */
  timeout?: number;
  /** Retries per request for transient failures. Defaults to 2. */
  maxRetries?: number;
}

/** Normalized, validated form of `CosmonerConfig`. */
export interface ResolvedConfig {
  apiKey: string;
  projectId?: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
}

/**
 * Validates constructor arguments and normalizes them.
 *
 * An explicitly empty `projectId` is rejected rather than silently treated as
 * unset — that almost always means an unresolved environment variable.
 */
export function resolveConfig(config: CosmonerConfig): ResolvedConfig {
  if (!config.apiKey) throw new Error("apiKey is required");
  if (config.projectId !== undefined && !config.projectId) {
    throw new Error("projectId is required");
  }

  const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  if (timeout <= 0) throw new Error("timeout must be greater than 0");
  if (maxRetries < 0) throw new Error("maxRetries cannot be negative");

  return {
    apiKey: config.apiKey,
    projectId: config.projectId,
    baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    timeout,
    maxRetries,
  };
}

/** Returns the per-call project id, falling back to the client-level default. */
export function resolveProjectId(config: ResolvedConfig, override?: string): string {
  const projectId = override || config.projectId;
  if (!projectId) {
    throw new Error(
      "projectId is required — pass it to the Cosmoner client or to this method"
    );
  }
  return projectId;
}
