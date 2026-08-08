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
}
