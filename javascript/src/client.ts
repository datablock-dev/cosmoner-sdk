/** Entry-point client exposing the API's service namespaces. */

import { resolveConfig, type CosmonerConfig, type ResolvedConfig } from "./config";
import { AppsService } from "./services/apps";
import { BucketsService } from "./services/buckets";
import { DatabasesService } from "./services/databases";
import { DomainsService } from "./services/domains";
import { EmailService } from "./services/email";
import { HostingService } from "./services/hosting";
import { IamService } from "./services/iam";
import { MembersService } from "./services/members";
import { ProjectsService } from "./services/projects";
import { RedisService } from "./services/redis";
import { RegistriesService } from "./services/registries";
import { SecretsService } from "./services/secrets";
import { ServersService } from "./services/servers";
import { SshKeysService } from "./services/ssh-keys";
import { VariablesService } from "./services/variables";
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
  readonly buckets: BucketsService;
  readonly databases: DatabasesService;
  readonly domains: DomainsService;
  readonly email: EmailService;
  readonly hosting: HostingService;
  readonly iam: IamService;
  readonly members: MembersService;
  /** Account-level: never uses the client's default project. */
  readonly projects: ProjectsService;
  readonly redis: RedisService;
  readonly registries: RegistriesService;
  readonly secrets: SecretsService;
  readonly servers: ServersService;
  readonly sshKeys: SshKeysService;
  readonly variables: VariablesService;
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
    this.buckets = new BucketsService(this.transport, this.config);
    this.databases = new DatabasesService(this.transport, this.config);
    this.domains = new DomainsService(this.transport, this.config);
    this.email = new EmailService(this.transport, this.config);
    this.hosting = new HostingService(this.transport, this.config);
    this.iam = new IamService(this.transport, this.config);
    this.members = new MembersService(this.transport, this.config);
    this.projects = new ProjectsService(this.transport);
    this.redis = new RedisService(this.transport, this.config);
    this.registries = new RegistriesService(this.transport, this.config);
    this.secrets = new SecretsService(this.transport, this.config);
    this.servers = new ServersService(this.transport, this.config);
    this.sshKeys = new SshKeysService(this.transport, this.config);
    this.variables = new VariablesService(this.transport, this.config);
    this.webhooks = new WebhooksService(this.transport, this.config);
  }
}
