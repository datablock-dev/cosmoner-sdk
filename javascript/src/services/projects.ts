/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Projects service namespace — the projects the credential can reach. */

import type { Transport } from "../transport";

/** A project as the API lists it. The API returns more; the rest are present at runtime. */
export interface Project {
  id: string;
  name: string;
  /** Falls back to the id for a project created without a slug. */
  slug: string;
  billingEmail: string | null;
  /** Set while the project is blocked for an unpaid invoice. */
  blockedAt: string | null;
  blockedReason: string | null;
  /** How many of each resource the project holds. */
  _count: {
    servers: number;
    domains: number;
    members: number;
    apps: number;
    objectStorages: number;
    containerRegistries: number;
    databaseClusters: number;
  };
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListProjectsResponse = Envelope<Project[]>;
export type GetProjectResponse = Envelope<Project>;

/** Arguments accepted by `client.projects.update()`. */
export interface UpdateProjectParams {
  /** 1–100 characters, unique among the caller's projects. */
  name: string;
}

export type UpdateProjectResponse = Envelope<Pick<Project, "id" | "name" | "slug" | "billingEmail">>;
export type DeleteProjectResponse = Envelope<null>;

/**
 * The projects the credential can reach.
 *
 * Account-level: it never uses the client's default project. An API key sees
 * the one project it was issued for; a `cosmoner login` session sees every
 * project its user is a member of.
 */
export class ProjectsService {
  constructor(private readonly transport: Transport) {}

  /** Lists every project the credential can reach, newest first. */
  async list(): Promise<ListProjectsResponse> {
    return this.transport.request<ListProjectsResponse>("GET", "/v1/projects");
  }

  /** Fetches one project by id or slug. */
  async get(project: string): Promise<GetProjectResponse> {
    if (!project) throw new Error("project is required");
    return this.transport.request<GetProjectResponse>("GET", `/v1/projects/${encodeURIComponent(project)}`);
  }

  /** Renames a project. Owners and admins only; 409 when the caller already has a project of that name. */
  async update(project: string, params: UpdateProjectParams): Promise<UpdateProjectResponse> {
    if (!project) throw new Error("project is required");
    if (!params?.name) throw new Error("name is required");
    return this.transport.request<UpdateProjectResponse>("PATCH", `/v1/projects/${encodeURIComponent(project)}`, {
      body: { name: params.name },
    });
  }

  /**
   * Permanently deletes a project. Owner only, and refused with 409 while it
   * still holds resources — servers, apps, databases and the rest have to be
   * deleted first, so nothing is left running and billed with no project.
   */
  async delete(project: string): Promise<DeleteProjectResponse> {
    if (!project) throw new Error("project is required");
    return this.transport.request<DeleteProjectResponse>("DELETE", `/v1/projects/${encodeURIComponent(project)}`);
  }
}
