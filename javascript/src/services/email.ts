/** Email service namespace — transactional sending through a project's SMTP credential. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";

/** Arguments accepted by `client.email.send()`. */
export interface SendEmailParams {
  credentialId: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/** Envelope returned by a successful send. */
export interface SendEmailResponse {
  success: true;
  data: { messageId: string };
}

/** A project's sending domain. SMTP passwords and the DKIM private key are never returned. */
export interface EmailDomain {
  id: string;
  domainId: string;
  status: "DNS_PENDING" | "ACTIVE" | "SUSPENDED";
  verifiedAt: string | null;
  domain: { id: string; name: string; status: string; type: string };
  credentials: Array<{
    id: string;
    label: string;
    fromAddress: string | null;
    smtpUsername: string;
    sentCount: number;
    lastUsedAt: string | null;
  }>;
  /** The records to publish before the domain can send. */
  dnsRecords: Array<{ type: "TXT"; name: string; value: string; purpose: "DKIM" | "SPF" | "DMARC"; description: string }>;
  createdAt: string;
}

/** A sending domain read on its own, with whether it can send yet. */
export interface EmailDomainDetail extends EmailDomain {
  sending: { identity: "VERIFIED" | "PENDING" | "FAILED" | "MISSING" | null; billingRequired: boolean };
}

/** Options accepted by the domain reads, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/** Envelope returned by `client.email.listDomains()`. */
export interface ListEmailDomainsResponse {
  success: true;
  data: EmailDomain[];
}

/** Envelope returned by `client.email.getDomain()`. */
export interface GetEmailDomainResponse {
  success: true;
  data: EmailDomainDetail;
}


/** Arguments accepted by `client.email.createCredential()`. */
export interface CreateSmtpCredentialParams extends ProjectScopedParams {
  label: string;
  /** The address it sends as; it must be on the sending domain. */
  fromAddress: string;
}

/** A new SMTP credential, with its password — returned this once. */
export interface NewSmtpCredential {
  id: string;
  label: string;
  fromAddress: string;
  smtpUsername: string;
  /** Store it now: the API keeps only a hash, and no later read returns it. */
  smtpPassword: string;
  sentCount: number;
  createdAt: string;
}

export interface CreateSmtpCredentialResponse {
  success: true;
  data: NewSmtpCredential;
}

/** Email operations for a project. */
export class EmailService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /**
   * Sends a transactional email and resolves with the API envelope.
   *
   * At least one of `html` or `text` is required.
   */
  // eslint-disable-next-line require-await -- `async` makes the validation below reject rather than throw synchronously.
  async send(params: SendEmailParams): Promise<SendEmailResponse> {
    if (!params.to) throw new Error("to is required");
    if (!params.subject) throw new Error("subject is required");
    if (!params.html && !params.text) {
      throw new Error("Either html or text must be provided");
    }

    const projectId = resolveProjectId(this.config, params.projectId);

    return this.transport.request<SendEmailResponse>(
      "POST",
      `/v1/projects/${projectId}/email/send`,
      {
        body: {
          credentialId: params.credentialId,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
          replyTo: params.replyTo,
        },
      }
    );
  }

  /** Lists the project's sending domains, with their SMTP credentials and DNS records. */
  // eslint-disable-next-line require-await -- kept `async` like every method here, so callers get one promise contract.
  async listDomains(params: ProjectScopedParams = {}): Promise<ListEmailDomainsResponse> {
    return this.transport.request<ListEmailDomainsResponse>(
      "GET",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email`
    );
  }

  /** Fetches one sending domain by its id (not its domain name). */
  // eslint-disable-next-line require-await -- `async` makes the validation below reject rather than throw synchronously.
  async getDomain(emailDomainId: string, params: ProjectScopedParams = {}): Promise<GetEmailDomainResponse> {
    if (!emailDomainId) throw new Error("emailDomainId is required");
    return this.transport.request<GetEmailDomainResponse>(
      "GET",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/${emailDomainId}`
    );
  }

  /**
   * Stops sending from a domain and removes it from email. The domain itself
   * stays in the project. The API answers 204, so there is nothing to return.
   */
  async deleteDomain(emailDomainId: string, params: ProjectScopedParams = {}): Promise<void> {
    if (!emailDomainId) throw new Error("emailDomainId is required");
    await this.transport.request<void>(
      "DELETE",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/${emailDomainId}`
    );
  }

  /**
   * Creates an SMTP credential for a sending domain. The response holds
   * `smtpPassword` this once: the API keeps only a hash.
   */
  // eslint-disable-next-line require-await -- `async` makes the validation below reject rather than throw synchronously.
  async createCredential(emailDomainId: string, params: CreateSmtpCredentialParams): Promise<CreateSmtpCredentialResponse> {
    if (!emailDomainId) throw new Error("emailDomainId is required");
    if (!params?.label) throw new Error("label is required");
    if (!params.fromAddress) throw new Error("fromAddress is required");
    return this.transport.request<CreateSmtpCredentialResponse>(
      "POST",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/${emailDomainId}/credentials`,
      { body: { label: params.label, fromAddress: params.fromAddress } }
    );
  }

  /**
   * Deletes an SMTP credential; anything sending with it stops working. The
   * API answers 204, so there is nothing to return.
   */
  async deleteCredential(emailDomainId: string, credentialId: string, params: ProjectScopedParams = {}): Promise<void> {
    if (!emailDomainId) throw new Error("emailDomainId is required");
    if (!credentialId) throw new Error("credentialId is required");
    await this.transport.request<void>(
      "DELETE",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/${emailDomainId}/credentials/${credentialId}`
    );
  }
}
