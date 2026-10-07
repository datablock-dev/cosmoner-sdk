/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** SSH keys service namespace — the public keys a project installs on its servers. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** A public SSH key. The private half is never stored or returned. */
export interface SshKey {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
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

export type ListSshKeysResponse = Envelope<SshKey[]>;

/** Read operations on a project's SSH keys. */
export class SshKeysService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Lists every SSH key in the project. */
  async list(params: ProjectScopedParams = {}): Promise<ListSshKeysResponse> {
    return this.transport.request<ListSshKeysResponse>(
      "GET",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/ssh-keys`
    );
  }
}
