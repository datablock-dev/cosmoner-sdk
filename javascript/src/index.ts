export interface CosmonerConfig {
  apiKey: string;
  projectId: string;
  baseUrl?: string;
}

export interface SendEmailParams {
  credentialId: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string | string[];
}

export interface SendEmailResponse {
  success: true;
  data: { messageId: string };
}

interface ErrorResponse {
  success: false;
  error: { code: string; message: string };
}

export class CosmonerError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CosmonerError";
    this.code = code;
    this.status = status;
  }
}

class EmailService {
  constructor(private readonly client: Cosmoner) {}

  async send(params: SendEmailParams): Promise<SendEmailResponse> {
    if (!params.to) throw new Error("to is required");
    if (!params.subject) throw new Error("subject is required");
    if (!params.html && !params.text) {
      throw new Error("Either html or text must be provided");
    }

    const url = `${this.client.baseUrl}/v1/projects/${this.client.projectId}/email/send`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.client.apiKey}`,
      },
      body: JSON.stringify({
        credentialId: params.credentialId,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        replyTo: params.replyTo,
      }),
    });

    const body = await res.json();

    if (!res.ok) {
      const err = body as ErrorResponse;
      throw new CosmonerError(
        res.status,
        err.error?.code ?? "UNKNOWN",
        err.error?.message ?? "Unknown error"
      );
    }

    return body as SendEmailResponse;
  }
}

export class Cosmoner {
  /** @internal */
  readonly apiKey: string;
  /** @internal */
  readonly projectId: string;
  /** @internal */
  readonly baseUrl: string;

  readonly email: EmailService;

  constructor(config: CosmonerConfig) {
    if (!config.apiKey) throw new Error("apiKey is required");
    if (!config.projectId) throw new Error("projectId is required");

    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.baseUrl = (config.baseUrl ?? "https://api.cosmoner.com").replace(
      /\/$/,
      ""
    );

    this.email = new EmailService(this);
  }
}

export default Cosmoner;
