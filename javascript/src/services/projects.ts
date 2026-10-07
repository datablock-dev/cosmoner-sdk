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

/**
 * Reads the projects the credential can reach.
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
}
