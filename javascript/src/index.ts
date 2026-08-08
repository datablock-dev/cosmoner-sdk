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
  EmailService,
  type SendEmailParams,
  type SendEmailResponse,
} from "./services/email";
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
