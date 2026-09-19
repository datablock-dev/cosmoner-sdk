/** Entry-point client exposing the API's service namespaces. */

import { resolveConfig, type CosmonerConfig, type ResolvedConfig } from "./config";
import { AppsService } from "./services/apps";
import { EmailService } from "./services/email";
import { HostingService } from "./services/hosting";
import { WebhooksService } from "./services/webhooks";
import { Transport } from "./transport";

/**
 * Cosmoner API client.
 *
 * `projectId` is optional: set it here to make it the default for every call,
 * or omit it and pass `projectId` per method to work across projects with one
 * client.
 */
export class Cosmoner {
  /** @internal */
  readonly apiKey: string;
  /** @internal */
  readonly projectId?: string;
  /** @internal */
  readonly baseUrl: string;
  /** @internal */
  readonly timeout: number;
  /** @internal */
  readonly maxRetries: number;

  private readonly config: ResolvedConfig;
  private readonly transport: Transport;

  readonly apps: AppsService;
  readonly email: EmailService;
  readonly hosting: HostingService;
  readonly webhooks: WebhooksService;

  constructor(config: CosmonerConfig) {
    this.config = resolveConfig(config);

    this.apiKey = this.config.apiKey;
    this.projectId = this.config.projectId;
    this.baseUrl = this.config.baseUrl;
    this.timeout = this.config.timeout;
    this.maxRetries = this.config.maxRetries;

    this.transport = new Transport(this.config);
    this.apps = new AppsService(this.transport, this.config);
    this.email = new EmailService(this.transport, this.config);
    this.hosting = new HostingService(this.transport, this.config);
    this.webhooks = new WebhooksService(this.transport, this.config);
  }
}
