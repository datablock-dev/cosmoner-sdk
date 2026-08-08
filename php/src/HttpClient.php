<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * Performs a single HTTP request.
 *
 * Injected into the client so callers can substitute their own PSR-18 adapter,
 * and so the SDK's own behaviour can be tested without a live server.
 */
interface HttpClient
{
    /**
     * Sends one request and returns the raw response.
     *
     * @param non-empty-string      $method
     * @param array<string, string> $headers
     *
     * @throws CosmonerConnectionError When the request never produced a response.
     */
    public function send(
        string $method,
        string $url,
        array $headers,
        ?string $body,
        float $timeout,
    ): HttpResponse;
}
