/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Variables service namespace — non-sensitive project configuration, held in plaintext. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";
import {
  requireEntryName,
  requireEntryValue,
  type Actor,
  type ProjectEnvironment,
} from "./project-config";

/**
 * A project variable: non-sensitive configuration held in plaintext.
 *
 * Unlike a secret, the value is returned in full on every read. That is the
 * difference between the two resources, not an oversight — anything worth
 * hiding belongs in `client.secrets`.
 */
export interface ProjectVariable {
  id: string;
  /** Uppercase, underscore-separated, e.g. `LOG_LEVEL`. */
  name: string;
  description: string | null;
  value: string;
  environment: ProjectEnvironment;
  /** Id of the member who created it. */
  createdBy: string;
  /** Id of the member who last changed it. */
  updatedBy: string;
  createdByUser: Actor;
  updatedByUser: Actor;
  createdAt: string;
  updatedAt: string;
}

/** Options accepted by every method, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/** Arguments accepted by `client.variables.list()`. */
export interface ListVariablesParams extends ProjectScopedParams {
  /** Limits the list to one environment. Omit to list them all. */
  environment?: ProjectEnvironment;
}

/** Arguments accepted by `client.variables.create()`. */
export interface CreateVariableParams extends ProjectScopedParams {
  /** Uppercase, underscore-separated, e.g. `LOG_LEVEL`. */
  name: string;
  value: string;
  description?: string;
  /** Defaults to `default` server-side. */
  environment?: ProjectEnvironment;
}

/**
 * Arguments accepted by `client.variables.update()`.
 *
 * Both fields are optional, but at least one has to be present — unlike a
 * secret, a variable can have its description changed without resetting its
 * value.
 */
export interface UpdateVariableParams extends ProjectScopedParams {
  value?: string;
  description?: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListVariablesResponse = Envelope<ProjectVariable[]>;
export type GetVariableResponse = Envelope<ProjectVariable>;
export type SetVariableResponse = Envelope<ProjectVariable>;

/**
 * Manages a project's variables.
 *
 * Reads need `variables:read`. Writes need `variables:write` *and* an owner or
 * admin: the API checks the member's role independently of the key's scopes,
 * so a plain member's key is refused even when it carries the scope.
 */
export class VariablesService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/variables`;
  }

  /** Lists the project's variables, values included. */
  async list(params: ListVariablesParams = {}): Promise<ListVariablesResponse> {
    return this.transport.request<ListVariablesResponse>("GET", this.basePath(params.projectId), {
      query: { environment: params.environment },
    });
  }

  /** Fetches one variable, value included. */
  async get(variableId: string, params: ProjectScopedParams = {}): Promise<GetVariableResponse> {
    if (!variableId) throw new Error("variableId is required");

    return this.transport.request<GetVariableResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${variableId}`
    );
  }

  /** Stores a new variable. */
  async create(params: CreateVariableParams): Promise<SetVariableResponse> {
    requireEntryName(params.name);
    requireEntryValue(params.value);

    return this.transport.request<SetVariableResponse>("POST", this.basePath(params.projectId), {
      body: {
        name: params.name,
        value: params.value,
        description: params.description,
        environment: params.environment,
      },
    });
  }

  /** Changes a variable's value, its description, or both. */
  async update(variableId: string, params: UpdateVariableParams): Promise<SetVariableResponse> {
    if (!variableId) throw new Error("variableId is required");
    if (params.value === undefined && params.description === undefined) {
      throw new Error("Provide a value or description to update");
    }
    if (params.value !== undefined) requireEntryValue(params.value);

    return this.transport.request<SetVariableResponse>(
      "PATCH",
      `${this.basePath(params.projectId)}/${variableId}`,
      { body: { value: params.value, description: params.description } }
    );
  }

  /** Permanently removes a variable. The API answers 204, so there is nothing to return. */
  async delete(variableId: string, params: ProjectScopedParams = {}): Promise<void> {
    if (!variableId) throw new Error("variableId is required");

    await this.transport.request<void>(
      "DELETE",
      `${this.basePath(params.projectId)}/${variableId}`
    );
  }
}
