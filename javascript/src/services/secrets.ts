/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Secrets service namespace — encrypted project configuration, revealed only as it is set. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";
import {
  requireEntryName,
  requireEntryValue,
  type Actor,
  type ProjectEnvironment,
} from "./project-config";

/**
 * A secret's metadata.
 *
 * The value is deliberately absent: it is encrypted at rest and returned
 * exactly once, by the call that sets it. Reads describe the secret without
 * ever handing the plaintext back, and no API route decrypts one.
 */
export interface ProjectSecret {
  id: string;
  /** Uppercase, underscore-separated, e.g. `DB_PASSWORD`. */
  name: string;
  description: string | null;
  environment: ProjectEnvironment;
  /** Incremented every time the value is replaced. Starts at 1. */
  version: number;
  /** Id of the member who created it. */
  createdBy: string;
  /** Id of the member who last changed it. */
  updatedBy: string;
  createdByUser: Actor;
  updatedByUser: Actor;
  createdAt: string;
  updatedAt: string;
}

/**
 * A secret together with its plaintext value, returned once at the moment it
 * is set.
 *
 * There is no way to read the value back afterwards, so a caller that discards
 * this response has to set a new value rather than recover this one.
 */
export interface RevealedProjectSecret {
  id: string;
  name: string;
  description: string | null;
  environment: ProjectEnvironment;
  version: number;
  /** Present on create. */
  createdAt?: string;
  /** Present on update. */
  updatedAt?: string;
  /** The plaintext value. Returned only here — store it before discarding the response. */
  value: string;
  /** The value with its middle replaced, e.g. `su••••et`. Safe to display. */
  maskedValue: string;
}

/** Secret capacity and what it costs to add more. */
export interface SecretsUsage {
  /** Secrets currently stored on the project. */
  used: number;
  /** How many the project may store, free allowance plus purchased packs. */
  limit: number;
  /** Secrets included before any pack is bought. */
  freeLimit: number;
  /** How many secrets one pack adds. */
  packSize: number;
  /** Packs currently on the subscription. */
  paidPacks: number;
  /** Null when pack pricing is unavailable. */
  packPrice: { monthly: number; currency: string } | null;
}

/** One entry in a secret's audit trail. Values never appear here — only who did what, and when. */
export interface SecretAuditEntry {
  id: string;
  secretId: string;
  action: "CREATED" | "UPDATED" | "DELETED";
  actorId: string;
  actor: Actor;
  metadata: string | null;
  createdAt: string;
}

/** Options accepted by every method, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/** Arguments accepted by `client.secrets.list()`. */
export interface ListSecretsParams extends ProjectScopedParams {
  /** Limits the list to one environment. Omit to list them all. */
  environment?: ProjectEnvironment;
}

/** Arguments accepted by `client.secrets.create()`. */
export interface CreateSecretParams extends ProjectScopedParams {
  /** Uppercase, underscore-separated, e.g. `DB_PASSWORD`. */
  name: string;
  value: string;
  description?: string;
  /** Defaults to `default` server-side. */
  environment?: ProjectEnvironment;
}

/** Arguments accepted by `client.secrets.update()`. */
export interface UpdateSecretParams extends ProjectScopedParams {
  /** Replaces the stored value and bumps `version`. */
  value: string;
  description?: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListSecretsResponse = Envelope<ProjectSecret[]>;
export type GetSecretResponse = Envelope<ProjectSecret>;
export type SetSecretResponse = Envelope<RevealedProjectSecret>;
export type GetSecretsUsageResponse = Envelope<SecretsUsage>;
export type GetSecretAuditResponse = Envelope<SecretAuditEntry[]>;

/**
 * Manages a project's secrets.
 *
 * Reads need `secrets:read`. Writes need `secrets:write` *and* an owner or
 * admin: the API checks the member's role independently of the key's scopes,
 * so a plain member's key is refused even when it carries the scope.
 */
export class SecretsService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/secrets`;
  }

  /** Lists the project's secrets as metadata. Values are never included. */
  async list(params: ListSecretsParams = {}): Promise<ListSecretsResponse> {
    return this.transport.request<ListSecretsResponse>("GET", this.basePath(params.projectId), {
      query: { environment: params.environment },
    });
  }

  /** Fetches one secret's metadata. The value is not part of the response. */
  async get(secretId: string, params: ProjectScopedParams = {}): Promise<GetSecretResponse> {
    if (!secretId) throw new Error("secretId is required");

    return this.transport.request<GetSecretResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${secretId}`
    );
  }

  /**
   * Stores a new secret, and returns its plaintext value once.
   *
   * Creation is rate-limited to 10 requests per 10 minutes, so a loop that
   * imports many secrets will meet a `RateLimitError`. A project at its limit
   * answers 402 — see `usage()`.
   */
  async create(params: CreateSecretParams): Promise<SetSecretResponse> {
    requireEntryName(params.name);
    requireEntryValue(params.value);

    return this.transport.request<SetSecretResponse>("POST", this.basePath(params.projectId), {
      body: {
        name: params.name,
        value: params.value,
        description: params.description,
        environment: params.environment,
      },
    });
  }

  /** Replaces a secret's value, bumps its version, and returns the new value once. */
  async update(secretId: string, params: UpdateSecretParams): Promise<SetSecretResponse> {
    if (!secretId) throw new Error("secretId is required");
    requireEntryValue(params.value);

    return this.transport.request<SetSecretResponse>(
      "PATCH",
      `${this.basePath(params.projectId)}/${secretId}`,
      { body: { value: params.value, description: params.description } }
    );
  }

  /** Permanently removes a secret. The API answers 204, so there is nothing to return. */
  async delete(secretId: string, params: ProjectScopedParams = {}): Promise<void> {
    if (!secretId) throw new Error("secretId is required");

    await this.transport.request<void>(
      "DELETE",
      `${this.basePath(params.projectId)}/${secretId}`
    );
  }

  /** Reports how many secrets the project holds, how many it may hold, and the price of more. */
  async usage(params: ProjectScopedParams = {}): Promise<GetSecretsUsageResponse> {
    return this.transport.request<GetSecretsUsageResponse>(
      "GET",
      `${this.basePath(params.projectId)}/usage`
    );
  }

  /** Reads a secret's audit trail: who changed it and when, never what it was changed to. */
  async audit(secretId: string, params: ProjectScopedParams = {}): Promise<GetSecretAuditResponse> {
    if (!secretId) throw new Error("secretId is required");

    return this.transport.request<GetSecretAuditResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${secretId}/audit`
    );
  }
}
