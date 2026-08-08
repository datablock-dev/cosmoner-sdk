<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\CosmonerConnectionError;
use Cosmoner\Sdk\HttpClient;
use Cosmoner\Sdk\HttpResponse;

/** Records requests and replays queued responses, so tests need no network. */
final class FakeHttpClient implements HttpClient
{
    /** @var list<array{method: string, url: string, headers: array<string, string>, body: ?string}> */
    public array $requests = [];

    /** @var list<HttpResponse|CosmonerConnectionError> */
    private array $queue = [];

    /** Queues a response (or a transport failure) to return from the next call. */
    public function queue(HttpResponse|CosmonerConnectionError $response): self
    {
        $this->queue[] = $response;

        return $this;
    }

    /**
     * Queues a JSON response with the given status.
     *
     * @param array<string, mixed>  $body
     * @param array<string, string> $headers
     */
    public function queueJson(int $status, array $body = [], array $headers = []): self
    {
        return $this->queue(new HttpResponse($status, (string) json_encode($body), $headers));
    }

    /** Returns the next queued response, repeating the last one once exhausted. */
    public function send(
        string $method,
        string $url,
        array $headers,
        ?string $body,
        float $timeout,
    ): HttpResponse {
        $this->requests[] = compact('method', 'url', 'headers', 'body');

        $next = count($this->queue) > 1 ? array_shift($this->queue) : ($this->queue[0] ?? null);

        if ($next === null) {
            throw new CosmonerConnectionError('No queued response');
        }
        if ($next instanceof CosmonerConnectionError) {
            throw $next;
        }

        return $next;
    }

    /** Number of requests recorded so far. */
    public function callCount(): int
    {
        return count($this->requests);
    }
}
