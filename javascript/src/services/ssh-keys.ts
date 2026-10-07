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

/** Arguments accepted by `client.sshKeys.create()`. */
export interface CreateSshKeyParams extends ProjectScopedParams {
  name: string;
  /** One OpenSSH public key line, e.g. the contents of `~/.ssh/id_ed25519.pub`. DSA keys are refused. */
  publicKey: string;
}

export type CreateSshKeyResponse = Envelope<SshKey>;
export type DeleteSshKeyResponse = Envelope<{
  /** Servers the key was already installed on, where it still works: deleting does not revoke it there. */
  stillAuthorisedOn: number;
}>;

/** A project's SSH keys. */
export class SshKeysService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Lists every SSH key in the project. */
  async list(params: ProjectScopedParams = {}): Promise<ListSshKeysResponse> {
    return this.transport.request<ListSshKeysResponse>("GET", this.basePath(params.projectId));
  }

  /** Adds a public key to the project, for installing on servers created later. */
  async create(params: CreateSshKeyParams): Promise<CreateSshKeyResponse> {
    if (!params?.name) throw new Error("name is required");
    if (!params.publicKey) throw new Error("publicKey is required");
    return this.transport.request<CreateSshKeyResponse>("POST", this.basePath(params.projectId), {
      body: { name: params.name, publicKey: params.publicKey },
    });
  }

  /**
   * Removes a key from the project. Servers it was already installed on keep
   * accepting it; `stillAuthorisedOn` says how many.
   */
  async delete(sshKeyId: string, params: ProjectScopedParams = {}): Promise<DeleteSshKeyResponse> {
    if (!sshKeyId) throw new Error("sshKeyId is required");
    return this.transport.request<DeleteSshKeyResponse>("DELETE", `${this.basePath(params.projectId)}/${sshKeyId}`);
  }

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/ssh-keys`;
  }
}
