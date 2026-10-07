/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Members service namespace — who belongs to a project. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** One member of a project. */
export interface ProjectMember {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: { name: string; email: string; image: string | null };
}

/** A project's members and the invitations not yet accepted. */
export interface ProjectMembers {
  orgId: string;
  /** The user the credential belongs to. */
  currentUserId: string;
  /** Who pays the project's invoices. */
  billerUserId: string | null;
  pendingBillerUserId: string | null;
  members: ProjectMember[];
  pendingInvitations: Array<{ id: string; email: string; role: string; expiresAt: string }>;
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

export type ListMembersResponse = Envelope<ProjectMembers>;

/** Read operations on a project's members. */
export class MembersService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Lists the project's members and pending invitations. */
  async list(params: ProjectScopedParams = {}): Promise<ListMembersResponse> {
    return this.transport.request<ListMembersResponse>(
      "GET",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/members`
    );
  }
}
