<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/** Webhook endpoint and delivery operations for a project. */
class WebhooksService
{
    /** Every event type an endpoint can subscribe to. */
    public const EVENT_TYPES = [
        'email.sent',
        'email.delivered',
        'email.delivery_delayed',
        'email.bounced',
        'email.complained',
        'email.opened',
        'email.clicked',
        'email.rejected',
        'email.rendering_failed',
        'email.domain_verified',
        'email.sending_paused',
        'app.deployed',
        'app.failed',
        'domain.verified',
        'domain.expired',
        'server.running',
        'server.error',
        'member.invited',
        'member.joined',
    ];

    /** Sentinel distinguishing "leave unchanged" from an explicit null. */
    private const UNSET = "\0__unset__\0";

    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every endpoint on the project, newest first.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: array<int, array<string, mixed>>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: array<int, array<string, mixed>>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one endpoint together with its delivery counts.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $endpointId, ?string $projectId = null): array
    {
        self::requireEndpointId($endpointId);

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$endpointId}");
    }

    /**
     * Creates an endpoint and returns it with its signing secret.
     *
     * The secret is returned by this call alone — every later read gives only
     * `secretHint`, so persist it before discarding the response.
     *
     * @param string   $name        Human-readable label.
     * @param string   $url         Must be an HTTPS URL; the API rejects plaintext endpoints.
     * @param string[] $events      Event types to subscribe to; at least one.
     * @param ?string  $description Optional free-text note.
     * @param ?string  $projectId   Overrides the client-level default project.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(
        string $name,
        string $url,
        array $events,
        ?string $description = null,
        ?string $projectId = null,
    ): array {
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }
        if ($url === '') {
            throw new InvalidArgumentException('url is required');
        }
        if ($events === []) {
            throw new InvalidArgumentException('At least one event is required');
        }

        $payload = ['name' => $name, 'url' => $url, 'events' => array_values($events)];
        if ($description !== null) {
            $payload['description'] = $description;
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('POST', $this->basePath($projectId), $payload);
    }

    /**
     * Updates an endpoint's configuration, sending only the fields given.
     *
     * Re-enabling a paused endpoint through `$enabled = true` also clears its
     * failure streak, so one more failure will not immediately re-pause it.
     * Pass `$description = null` to clear the description; leave it out to
     * keep the current value.
     *
     * @param string[]|null $events Event types to subscribe to; at least one when given.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function update(
        string $endpointId,
        ?string $name = null,
        ?string $url = null,
        ?array $events = null,
        ?string $description = self::UNSET,
        ?bool $enabled = null,
        ?string $projectId = null,
    ): array {
        self::requireEndpointId($endpointId);
        if ($events !== null && $events === []) {
            throw new InvalidArgumentException('At least one event is required');
        }

        $payload = [];
        if ($name !== null) {
            $payload['name'] = $name;
        }
        if ($url !== null) {
            $payload['url'] = $url;
        }
        if ($events !== null) {
            $payload['events'] = array_values($events);
        }
        if ($description !== self::UNSET) {
            $payload['description'] = $description;
        }
        if ($enabled !== null) {
            $payload['enabled'] = $enabled;
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'PATCH',
            $this->basePath($projectId) . "/{$endpointId}",
            // See test(): an empty array would encode as "[]", not "{}".
            $payload === [] ? null : $payload,
        );
    }

    /**
     * Deletes an endpoint and its delivery history.
     *
     * @return array{success: true, data: null}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $endpointId, ?string $projectId = null): array
    {
        self::requireEndpointId($endpointId);

        /** @var array{success: true, data: null} */
        return $this->transport->request(
            'DELETE',
            $this->basePath($projectId) . "/{$endpointId}",
        );
    }

    /**
     * Clears an auto-pause and re-queues the backlog held while it was down.
     *
     * An endpoint pauses itself after ten consecutive failed deliveries.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function resume(string $endpointId, ?string $projectId = null): array
    {
        self::requireEndpointId($endpointId);

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId) . "/{$endpointId}/resume",
        );
    }

    /**
     * Issues a new signing secret and returns it in full.
     *
     * The previous secret stops verifying immediately, so deploy the new one
     * before rotating if the receiver cannot tolerate rejected deliveries.
     *
     * @return array{success: true, data: array{id: string, secret: string}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function rotateSecret(string $endpointId, ?string $projectId = null): array
    {
        self::requireEndpointId($endpointId);

        /** @var array{success: true, data: array{id: string, secret: string}} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId) . "/{$endpointId}/rotate-secret",
        );
    }

    /**
     * Sends a synthetic event and reports what the endpoint answered.
     *
     * Defaults to the endpoint's first subscribed event. Test sends never move
     * the failure streak in either direction.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function test(
        string $endpointId,
        ?string $eventType = null,
        ?string $projectId = null,
    ): array {
        self::requireEndpointId($endpointId);

        // Sent as no body rather than an empty array: json_encode([]) emits "[]",
        // which the API rejects as an array where it expects an object.
        $payload = $eventType !== null ? ['eventType' => $eventType] : null;

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId) . "/{$endpointId}/test",
            $payload,
        );
    }

    /**
     * Lists deliveries for an endpoint, newest first, cursor-paginated.
     *
     * @param ?string $status    One of PENDING, SUCCEEDED, FAILED.
     * @param ?int    $limit     1–100; the API defaults to 25.
     * @param ?string $cursor    `nextCursor` from the previous page.
     *
     * @return array{success: true, data: array{deliveries: array<int, array<string, mixed>>, nextCursor: ?string}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function listDeliveries(
        string $endpointId,
        ?string $status = null,
        ?string $eventType = null,
        ?int $limit = null,
        ?string $cursor = null,
        ?string $projectId = null,
    ): array {
        self::requireEndpointId($endpointId);

        $query = [];
        if ($status !== null) {
            $query['status'] = $status;
        }
        if ($eventType !== null) {
            $query['eventType'] = $eventType;
        }
        if ($limit !== null) {
            $query['limit'] = $limit;
        }
        if ($cursor !== null) {
            $query['cursor'] = $cursor;
        }

        /** @var array{success: true, data: array{deliveries: array<int, array<string, mixed>>, nextCursor: ?string}} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/{$endpointId}/deliveries",
            null,
            $query,
        );
    }

    /**
     * Queues a fresh delivery carrying the same payload.
     *
     * The endpoint must be enabled — replaying into a paused endpoint fails
     * rather than silently queueing behind the backlog.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function replayDelivery(
        string $endpointId,
        string $deliveryId,
        ?string $projectId = null,
    ): array {
        self::requireEndpointId($endpointId);
        if ($deliveryId === '') {
            throw new InvalidArgumentException('deliveryId is required');
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'POST',
            $this->basePath($projectId) . "/{$endpointId}/deliveries/{$deliveryId}/replay",
        );
    }

    /**
     * Reports whether a received request carries a valid signature.
     *
     * Convenience wrapper over {@see WebhookSignature::verify()} for callers
     * that already hold a client. Needs the raw request body.
     */
    public function verify(
        string $payload,
        string $signature,
        string $secret,
        int $toleranceSeconds = WebhookSignature::DEFAULT_TOLERANCE_SECONDS,
    ): bool {
        return WebhookSignature::verify($payload, $signature, $secret, $toleranceSeconds);
    }

    /**
     * Verifies a received request and returns its decoded event envelope.
     *
     * @return array<string, mixed>
     *
     * @throws WebhookSignatureError When verification fails.
     */
    public function constructEvent(
        string $payload,
        string $signature,
        string $secret,
        int $toleranceSeconds = WebhookSignature::DEFAULT_TOLERANCE_SECONDS,
    ): array {
        return WebhookSignature::constructEvent($payload, $signature, $secret, $toleranceSeconds);
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/webhooks';
    }

    /** Rejects an empty endpoint id before it becomes a malformed route. */
    private static function requireEndpointId(string $endpointId): void
    {
        if ($endpointId === '') {
            throw new InvalidArgumentException('endpointId is required');
        }
    }
}
