<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * Cosmoner API client.
 *
 * `$projectId` is optional: set it here to make it the default for every call,
 * or omit it and pass `$projectId` per method to work across projects with one
 * client.
 */
class Cosmoner
{
    public readonly string $apiKey;
    public readonly ?string $projectId;
    public readonly string $baseUrl;
    public readonly float $timeout;
    public readonly int $maxRetries;

    public readonly EmailService $email;

    private readonly Config $config;
    private readonly Transport $transport;

    public function __construct(
        string $apiKey,
        ?string $projectId = null,
        string $baseUrl = Config::DEFAULT_BASE_URL,
        float $timeout = Config::DEFAULT_TIMEOUT,
        int $maxRetries = Config::DEFAULT_MAX_RETRIES,
        ?HttpClient $httpClient = null,
    ) {
        $this->config = new Config($apiKey, $projectId, $baseUrl, $timeout, $maxRetries);

        $this->apiKey = $this->config->apiKey;
        $this->projectId = $this->config->projectId;
        $this->baseUrl = $this->config->baseUrl;
        $this->timeout = $this->config->timeout;
        $this->maxRetries = $this->config->maxRetries;

        $this->transport = new Transport($this->config, $httpClient ?? new CurlHttpClient());
        $this->email = new EmailService($this->transport, $this->config);
    }
}
