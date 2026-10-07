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

/** Envelope returned by `client.email.createDomain()` and `createExternalDomain()`. */
export interface CreateEmailDomainResponse {
  success: true;
  data: EmailDomain;
}

/** Arguments accepted by `client.email.createDomain()`. */
export interface CreateEmailDomainParams extends ProjectScopedParams {
  /** A domain already in the project, from `client.domains`. */
  domainId: string;
}

/** Arguments accepted by `client.email.createExternalDomain()`. */
export interface CreateExternalEmailDomainParams extends ProjectScopedParams {
  /** A domain whose DNS is hosted somewhere else. */
  domainName: string;
}

/** What `client.email.verifyDomain()` found. */
export interface EmailDomainVerification {
  status: EmailDomain["status"];
  verifiedAt: string | null;
  /** Each record to publish, and whether it was found. */
  records: Array<EmailDomain["dnsRecords"][number] & { verified: boolean; error: string | null }>;
}

/** Envelope returned by `client.email.verifyDomain()`. */
export interface VerifyEmailDomainResponse {
  success: true;
  data: EmailDomainVerification;
}

/** The project's email plan, its allowances, and what it has sent against them. */
export interface EmailLimits {
  plan: "PAY_AS_YOU_GO" | "STARTER" | "PRO" | "SCALE" | "BUSINESS";
  /** Emails a month the plan's flat price covers; 0 on Pay as you go, where every email is billed. */
  includedEmails: number;
  /** The project's own monthly cap. */
  monthlyQuota: number;
  hourlyLimit: number;
  dailyLimit: number;
  sentThisMonth: number;
  sentLastDay: number;
  sentLastHour: number;
  /** Start of the current quota month. */
  periodStart: string;
  /** Set while sending is paused: when it resumes. */
  pausedUntil: string | null;
  pauseReason: "HOURLY_LIMIT" | "DAILY_LIMIT" | "MONTHLY_QUOTA" | null;
  pendingRequest: { id: string; requestedLimit: number; createdAt: string } | null;
}

/** Envelope returned by `client.email.limits()`. */
export interface GetEmailLimitsResponse {
  success: true;
  data: EmailLimits;
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
   * Sets a domain already in the project up for sending. The response lists
   * the DNS records to publish; then call `verifyDomain`. 409 when email is
   * already set up on it.
   */
  // eslint-disable-next-line require-await -- `async` makes the validation below reject rather than throw synchronously.
  async createDomain(params: CreateEmailDomainParams): Promise<CreateEmailDomainResponse> {
    if (!params?.domainId) throw new Error("domainId is required");
    return this.transport.request<CreateEmailDomainResponse>(
      "POST",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email`,
      { body: { domainId: params.domainId } }
    );
  }

  /**
   * Sets up sending from a domain whose DNS is hosted elsewhere, adding it to
   * the project as `PENDING` until its records resolve. The response lists the
   * DNS records to publish; then call `verifyDomain`. 409 when the project
   * already has the domain — use `createDomain` — or it cannot be used here.
   */
  // eslint-disable-next-line require-await -- `async` makes the validation below reject rather than throw synchronously.
  async createExternalDomain(params: CreateExternalEmailDomainParams): Promise<CreateEmailDomainResponse> {
    if (!params?.domainName) throw new Error("domainName is required");
    return this.transport.request<CreateEmailDomainResponse>(
      "POST",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/external`,
      { body: { domainName: params.domainName } }
    );
  }

  /**
   * Checks a sending domain's DNS records. When they all resolve the domain
   * goes `ACTIVE`, and its first activation puts the project's email plan on
   * its subscription — refused with 402 when the project cannot be billed.
   */
  // eslint-disable-next-line require-await -- `async` makes the validation below reject rather than throw synchronously.
  async verifyDomain(emailDomainId: string, params: ProjectScopedParams = {}): Promise<VerifyEmailDomainResponse> {
    if (!emailDomainId) throw new Error("emailDomainId is required");
    return this.transport.request<VerifyEmailDomainResponse>(
      "POST",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/${emailDomainId}/verify`
    );
  }

  /** Reads the project's email plan, its sending limits and its usage against them. */
  // eslint-disable-next-line require-await -- kept `async` like every method here, so callers get one promise contract.
  async limits(params: ProjectScopedParams = {}): Promise<GetEmailLimitsResponse> {
    return this.transport.request<GetEmailLimitsResponse>(
      "GET",
      `/v1/projects/${resolveProjectId(this.config, params.projectId)}/email/limits`
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
