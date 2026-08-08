/* eslint-disable require-await -- Every method here validates its arguments before
   reaching the transport. Keeping them `async` makes a bad argument reject the
   returned promise rather than throw synchronously, so one `.catch()` covers both
   client-side and server-side failures. */

/** Webhooks service namespace — endpoint management and delivery inspection. */

import { resolveProjectId, type ResolvedConfig } from "../config";
import type { Transport } from "../transport";
import {
  constructEvent,
  verifyWebhookSignature,
  type VerifyWebhookParams,
  type WebhookEvent,
} from "../webhooks/signature";

/** Every event type an endpoint can subscribe to. */
export const WEBHOOK_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.opened",
  "email.clicked",
  "email.rejected",
  "email.rendering_failed",
  "email.domain_verified",
  "email.sending_paused",
  "app.deployed",
  "app.failed",
  "domain.verified",
  "domain.expired",
  "server.running",
  "server.error",
  "member.invited",
  "member.joined",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Lifecycle state of a single delivery attempt chain. */
export type WebhookDeliveryStatus = "PENDING" | "SUCCEEDED" | "FAILED";

/** Why an endpoint stopped receiving events. */
export type WebhookDisabledReason = "MANUAL" | "CONSECUTIVE_FAILURES";

/** A configured webhook endpoint. The full secret is never returned here. */
export interface WebhookEndpoint {
  id: string;
  name: string;
  description: string | null;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  /** Last four characters of the signing secret — enough to tell keys apart. */
  secretHint: string;
  consecutiveFailures: number;
  disabledAt: string | null;
  disabledReason: WebhookDisabledReason | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Delivery counts behind an endpoint's health badge. */
export interface WebhookEndpointStats {
  succeeded: number;
  failed: number;
  pending: number;
}

/** One attempt chain for one event against one endpoint. */
export interface WebhookDelivery {
  id: string;
  eventType: WebhookEventType;
  eventId: string;
  payload: unknown;
  status: WebhookDeliveryStatus;
  attempt: number;
  nextAttemptAt: string | null;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** Options accepted by every method, for working across projects. */
export interface ProjectScopedParams {
  /** Overrides the client-level default project for this call. */
  projectId?: string;
}

/** Arguments accepted by `client.webhooks.create()`. */
export interface CreateWebhookEndpointParams extends ProjectScopedParams {
  name: string;
  /** Must be an HTTPS URL — the API rejects plaintext endpoints. */
  url: string;
  events: WebhookEventType[];
  description?: string;
}

/** Arguments accepted by `client.webhooks.update()`. */
export interface UpdateWebhookEndpointParams extends ProjectScopedParams {
  name?: string;
  url?: string;
  events?: WebhookEventType[];
  /** Pass null to clear the description. */
  description?: string | null;
  enabled?: boolean;
}

/** Filters accepted by `client.webhooks.listDeliveries()`. */
export interface ListDeliveriesParams extends ProjectScopedParams {
  status?: WebhookDeliveryStatus;
  eventType?: WebhookEventType;
  /** 1–100, defaults to 25 server-side. */
  limit?: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

/** An endpoint returned with its signing secret, shown only once. */
export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /**
   * The full signing secret. Returned only when the endpoint is created —
   * store it now, because no later call can retrieve it.
   */
  secret: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListWebhookEndpointsResponse = Envelope<WebhookEndpoint[]>;
export type GetWebhookEndpointResponse = Envelope<{
  endpoint: WebhookEndpoint;
  stats: WebhookEndpointStats;
}>;
export type CreateWebhookEndpointResponse = Envelope<WebhookEndpointWithSecret>;
export type UpdateWebhookEndpointResponse = Envelope<WebhookEndpoint>;
export type ResumeWebhookEndpointResponse = Envelope<WebhookEndpoint>;
export type RotateWebhookSecretResponse = Envelope<{ id: string; secret: string }>;
export type TestWebhookEndpointResponse = Envelope<{
  outcome: string;
  delivery: WebhookDelivery;
}>;
export type ListWebhookDeliveriesResponse = Envelope<{
  deliveries: WebhookDelivery[];
  nextCursor: string | null;
}>;
export type ReplayWebhookDeliveryResponse = Envelope<WebhookDelivery>;
export type DeleteWebhookEndpointResponse = Envelope<null>;

/** Webhook endpoint and delivery operations for a project. */
export class WebhooksService {
  constructor(
    private readonly transport: Transport,
    private readonly config: ResolvedConfig
  ) {}

  /** Builds the collection route for the resolved project. */
  private basePath(projectId?: string): string {
    return `/v1/projects/${resolveProjectId(this.config, projectId)}/webhooks`;
  }

  /** Lists every endpoint on the project, newest first. */
  async list(params: ProjectScopedParams = {}): Promise<ListWebhookEndpointsResponse> {
    return this.transport.request<ListWebhookEndpointsResponse>(
      "GET",
      this.basePath(params.projectId)
    );
  }

  /** Fetches one endpoint together with its delivery counts. */
  async get(
    endpointId: string,
    params: ProjectScopedParams = {}
  ): Promise<GetWebhookEndpointResponse> {
    if (!endpointId) throw new Error("endpointId is required");

    return this.transport.request<GetWebhookEndpointResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${endpointId}`
    );
  }

  /**
   * Creates an endpoint and returns it with its signing secret.
   *
   * The secret is returned by this call alone — every later read gives only
   * `secretHint`, so persist it before discarding the response.
   */
  async create(params: CreateWebhookEndpointParams): Promise<CreateWebhookEndpointResponse> {
    if (!params.name) throw new Error("name is required");
    if (!params.url) throw new Error("url is required");
    if (!params.events?.length) throw new Error("At least one event is required");

    return this.transport.request<CreateWebhookEndpointResponse>(
      "POST",
      this.basePath(params.projectId),
      {
        body: {
          name: params.name,
          url: params.url,
          events: params.events,
          description: params.description,
        },
      }
    );
  }

  /**
   * Updates an endpoint's configuration.
   *
   * Re-enabling a paused endpoint through `enabled: true` also clears its
   * failure streak, so one more failure will not immediately re-pause it.
   */
  async update(
    endpointId: string,
    params: UpdateWebhookEndpointParams
  ): Promise<UpdateWebhookEndpointResponse> {
    if (!endpointId) throw new Error("endpointId is required");
    if (params.events && params.events.length === 0) {
      throw new Error("At least one event is required");
    }

    return this.transport.request<UpdateWebhookEndpointResponse>(
      "PATCH",
      `${this.basePath(params.projectId)}/${endpointId}`,
      {
        body: {
          name: params.name,
          url: params.url,
          events: params.events,
          description: params.description,
          enabled: params.enabled,
        },
      }
    );
  }

  /** Deletes an endpoint and its delivery history. */
  async delete(
    endpointId: string,
    params: ProjectScopedParams = {}
  ): Promise<DeleteWebhookEndpointResponse> {
    if (!endpointId) throw new Error("endpointId is required");

    return this.transport.request<DeleteWebhookEndpointResponse>(
      "DELETE",
      `${this.basePath(params.projectId)}/${endpointId}`
    );
  }

  /**
   * Clears an auto-pause and re-queues the backlog held while it was down.
   *
   * An endpoint pauses itself after ten consecutive failed deliveries.
   */
  async resume(
    endpointId: string,
    params: ProjectScopedParams = {}
  ): Promise<ResumeWebhookEndpointResponse> {
    if (!endpointId) throw new Error("endpointId is required");

    return this.transport.request<ResumeWebhookEndpointResponse>(
      "POST",
      `${this.basePath(params.projectId)}/${endpointId}/resume`
    );
  }

  /**
   * Issues a new signing secret and returns it in full.
   *
   * The previous secret stops verifying immediately, so deploy the new one
   * before rotating if the receiver cannot tolerate rejected deliveries.
   */
  async rotateSecret(
    endpointId: string,
    params: ProjectScopedParams = {}
  ): Promise<RotateWebhookSecretResponse> {
    if (!endpointId) throw new Error("endpointId is required");

    return this.transport.request<RotateWebhookSecretResponse>(
      "POST",
      `${this.basePath(params.projectId)}/${endpointId}/rotate-secret`
    );
  }

  /**
   * Sends a synthetic event and reports what the endpoint answered.
   *
   * Defaults to the endpoint's first subscribed event. Test sends never move
   * the failure streak in either direction.
   */
  async test(
    endpointId: string,
    params: ProjectScopedParams & { eventType?: WebhookEventType } = {}
  ): Promise<TestWebhookEndpointResponse> {
    if (!endpointId) throw new Error("endpointId is required");

    return this.transport.request<TestWebhookEndpointResponse>(
      "POST",
      `${this.basePath(params.projectId)}/${endpointId}/test`,
      { body: { eventType: params.eventType } }
    );
  }

  /** Lists deliveries for an endpoint, newest first, cursor-paginated. */
  async listDeliveries(
    endpointId: string,
    params: ListDeliveriesParams = {}
  ): Promise<ListWebhookDeliveriesResponse> {
    if (!endpointId) throw new Error("endpointId is required");

    return this.transport.request<ListWebhookDeliveriesResponse>(
      "GET",
      `${this.basePath(params.projectId)}/${endpointId}/deliveries`,
      {
        query: {
          status: params.status,
          eventType: params.eventType,
          limit: params.limit,
          cursor: params.cursor,
        },
      }
    );
  }

  /**
   * Queues a fresh delivery carrying the same payload.
   *
   * The endpoint must be enabled — replaying into a paused endpoint fails
   * rather than silently queueing behind the backlog.
   */
  async replayDelivery(
    endpointId: string,
    deliveryId: string,
    params: ProjectScopedParams = {}
  ): Promise<ReplayWebhookDeliveryResponse> {
    if (!endpointId) throw new Error("endpointId is required");
    if (!deliveryId) throw new Error("deliveryId is required");

    return this.transport.request<ReplayWebhookDeliveryResponse>(
      "POST",
      `${this.basePath(params.projectId)}/${endpointId}/deliveries/${deliveryId}/replay`
    );
  }

  /**
   * Reports whether a received request carries a valid signature.
   *
   * Needs the raw request body: a re-serialized object will not match what
   * was signed.
   */
  verify(params: VerifyWebhookParams): boolean {
    return verifyWebhookSignature(params);
  }

  /**
   * Verifies a received request and returns its parsed event envelope.
   *
   * Throws `WebhookSignatureError` when verification fails, so there is no
   * payload to act on unless the signature held.
   */
  constructEvent<T = unknown>(params: VerifyWebhookParams): WebhookEvent<T> {
    return constructEvent<T>(params);
  }
}
