/** Public entry point for the Cosmoner SDK. */

export { Cosmoner } from "./client";
export {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type CosmonerConfig,
} from "./config";
export {
  AuthenticationError,
  ConflictError,
  CosmonerConnectionError,
  CosmonerError,
  CosmonerTimeoutError,
  InsufficientScopeError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
  WebhookSignatureError,
} from "./errors";
export {
  APP_SCHEMA_URL,
  DEPLOYMENT_FILE_PATHS,
  DEPLOYMENT_KEY_ORDER,
  DEPLOYMENT_VERSION,
  MAX_DEPLOYMENT_BYTES,
} from "./deployment/spec";
export {
  validateDeployment,
  validateDeploymentDocument,
} from "./deployment/validate";
export type {
  DeploymentBuild,
  DeploymentEnvVar,
  DeploymentIssue,
  DeploymentIssueSeverity,
  DeploymentService,
  DeploymentTemplate,
  DeploymentValidationResult,
  ValidateDeploymentOptions,
} from "./deployment/types";
export {
  AppsService,
  FINISHED_DEPLOYMENT_PHASES,
  type App,
  type AppDeployment,
  type AppStatus,
  type DeployAppParams,
  type DeployAppResponse,
  type DeploymentPhase,
  type GetDeploymentResponse,
  type ImageDeployPolicy,
  type ListAppsResponse,
  type WaitForDeploymentParams,
} from "./services/apps";
export {
  EmailService,
  type SendEmailParams,
  type SendEmailResponse,
} from "./services/email";
export {
  HostingService,
  type GetHostingAccessResponse,
  type GetHostingSiteParams,
  type GetHostingSiteResponse,
  type GetHostingSiteWithCredentialsResponse,
  type HostingAccess,
  type HostingSite,
  type HostingSiteStatus,
  type HostingSiteWithCredentials,
  type ListHostingSitesResponse,
} from "./services/hosting";
export {
  PROJECT_ENVIRONMENTS,
  type Actor,
  type ProjectEnvironment,
} from "./services/project-config";
export {
  SecretsService,
  type CreateSecretParams,
  type GetSecretAuditResponse,
  type GetSecretResponse,
  type GetSecretsUsageResponse,
  type ListSecretsParams,
  type ListSecretsResponse,
  type ProjectSecret,
  type RevealedProjectSecret,
  type SecretAuditEntry,
  type SecretsUsage,
  type SetSecretResponse,
  type UpdateSecretParams,
} from "./services/secrets";
export {
  VariablesService,
  type CreateVariableParams,
  type GetVariableResponse,
  type ListVariablesParams,
  type ListVariablesResponse,
  type ProjectVariable,
  type SetVariableResponse,
  type UpdateVariableParams,
} from "./services/variables";
export {
  WEBHOOK_EVENT_TYPES,
  WebhooksService,
  type CreateWebhookEndpointParams,
  type CreateWebhookEndpointResponse,
  type DeleteWebhookEndpointResponse,
  type GetWebhookEndpointResponse,
  type ListDeliveriesParams,
  type ListWebhookDeliveriesResponse,
  type ListWebhookEndpointsResponse,
  type ReplayWebhookDeliveryResponse,
  type ResumeWebhookEndpointResponse,
  type RotateWebhookSecretResponse,
  type TestWebhookEndpointResponse,
  type UpdateWebhookEndpointParams,
  type UpdateWebhookEndpointResponse,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookDisabledReason,
  type WebhookEndpoint,
  type WebhookEndpointStats,
  type WebhookEndpointWithSecret,
  type WebhookEventType,
} from "./services/webhooks";
export {
  constructEvent,
  DEFAULT_TOLERANCE_SECONDS,
  DELIVERY_ID_HEADER,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
  verifyWebhookSignature,
  type VerifyWebhookParams,
  type WebhookEvent,
} from "./webhooks/signature";
export { VERSION } from "./version";

import { Cosmoner } from "./client";

export default Cosmoner;
