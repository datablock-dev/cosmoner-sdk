<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** HTTP transport: header assembly, retries, and response/error decoding. */
final class Transport
{
    /** Methods that mutate state and therefore carry an idempotency key. */
    private const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    private const VERSION = '1.0.0';

    private readonly Retry $retry;

    public function __construct(
        private readonly Config $config,
        private readonly HttpClient $httpClient = new CurlHttpClient(),
    ) {
        $this->retry = new Retry($config->maxRetries);
    }

    /**
     * Issues a request, retrying transient failures, and returns the decoded body.
     *
     * @param array<string, mixed>|null $body
     * @param array<string, scalar>     $query
     *
     * @return array<string, mixed>
     *
     * @throws CosmonerError On API and transport failures.
     */
    public function request(
        string $method,
        string $path,
        ?array $body = null,
        array $query = [],
        ?string $idempotencyKey = null,
        bool $retryNonIdempotent = false,
    ): array {
        $url = $this->config->baseUrl . $path;
        if ($query !== []) {
            $url .= '?' . http_build_query($query);
        }

        $headers = $this->headers($method, $body !== null, $idempotencyKey);
        $encoded = $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR);
        $attempt = 0;

        while (true) {
            $status = null;
            $retryAfter = null;
            $response = null;
            $error = null;

            try {
                $response = $this->httpClient->send(
                    $method,
                    $url,
                    $headers,
                    $encoded,
                    $this->config->timeout,
                );
                $status = $response->status;
                $retryAfter = Retry::parseRetryAfter($response->headers);

                if ($response->isSuccess()) {
                    return $this->decode($response);
                }
            } catch (CosmonerConnectionError $err) {
                $error = $err;
            }

            if (!$this->retry->shouldRetry($attempt, $method, $status, $retryNonIdempotent)) {
                if ($error !== null) {
                    throw $error;
                }

                return $this->decode($response); // throws the mapped API error
            }

            usleep((int) round($this->retry->backoffSeconds($attempt, $retryAfter) * 1_000_000));
            $attempt++;
        }
    }

    /**
     * Builds the header set for one request.
     *
     * The idempotency key is generated once per logical request and reused
     * across retries, so a replayed write can be collapsed server-side. The API
     * does not consume this header yet — it is sent now so that retries become
     * safe for writes as soon as it does.
     *
     * @return array<string, string>
     */
    private function headers(string $method, bool $hasBody, ?string $idempotencyKey): array
    {
        $headers = [
            'Authorization' => 'Bearer ' . $this->config->apiKey,
            'Accept' => 'application/json',
            'User-Agent' => 'cosmoner-php/' . self::VERSION,
        ];

        if ($hasBody) {
            $headers['Content-Type'] = 'application/json';
        }

        if (in_array(strtoupper($method), self::WRITE_METHODS, true)) {
            $headers['Idempotency-Key'] = $idempotencyKey ?? bin2hex(random_bytes(16));
        }

        return $headers;
    }

    /**
     * Parses a successful response body, or throws the mapped API error.
     *
     * @return array<string, mixed>
     */
    private function decode(HttpResponse $response): array
    {
        $body = json_decode($response->body, true);
        if (!is_array($body)) {
            $body = null;
        }

        if ($response->isSuccess()) {
            if ($body === null) {
                throw new CosmonerError(
                    $response->status,
                    'INVALID_RESPONSE',
                    'API returned a non-JSON response',
                );
            }

            return $body;
        }

        throw $this->errorFromResponse($response, $body);
    }

    /**
     * Maps an error response onto the most specific error class available.
     *
     * Proxies and load balancers can return HTML or an empty body, so every
     * field is read defensively.
     *
     * @param array<string, mixed>|null $body
     */
    private function errorFromResponse(HttpResponse $response, ?array $body): CosmonerError
    {
        $error = is_array($body['error'] ?? null) ? $body['error'] : [];
        $code = is_string($error['code'] ?? null) ? $error['code'] : 'UNKNOWN';
        $message = is_string($error['message'] ?? null) ? $error['message'] : 'Unknown error';
        $details = $error['details'] ?? null;
        $requestId = $response->headers['x-request-id'] ?? null;
        $status = $response->status;

        return match (true) {
            $status === 400, $status === 422 => new ValidationError($status, $code, $message, $details, $requestId),
            $status === 401 => new AuthenticationError($status, $code, $message, $details, $requestId),
            $status === 403 => new InsufficientScopeError($status, $code, $message, $details, $requestId),
            $status === 404 => new NotFoundError($status, $code, $message, $details, $requestId),
            $status === 409 => new ConflictError($status, $code, $message, $details, $requestId),
            $status === 429 => new RateLimitError(
                $status,
                $code,
                $message,
                $details,
                $requestId,
                Retry::parseRetryAfter($response->headers),
            ),
            $status >= 500 => new ServerError($status, $code, $message, $details, $requestId),
            default => new CosmonerError($status, $code, $message, $details, $requestId),
        };
    }
}
