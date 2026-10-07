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

    public readonly AppsService $apps;
    public readonly BucketsService $buckets;
    public readonly CatalogService $catalog;
    public readonly DatabasesService $databases;
    public readonly DomainsService $domains;
    public readonly EmailService $email;
    public readonly HostingService $hosting;
    public readonly IamService $iam;
    public readonly MembersService $members;
    public readonly ProjectsService $projects;
    public readonly RedisService $redis;
    public readonly RegistriesService $registries;
    public readonly SecretsService $secrets;
    public readonly ServersService $servers;
    public readonly SshKeysService $sshKeys;
    public readonly VariablesService $variables;
    public readonly WebhooksService $webhooks;

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
        $this->apps = new AppsService($this->transport, $this->config);
        $this->buckets = new BucketsService($this->transport, $this->config);
        $this->catalog = new CatalogService($this->transport);
        $this->databases = new DatabasesService($this->transport, $this->config);
        $this->domains = new DomainsService($this->transport, $this->config);
        $this->email = new EmailService($this->transport, $this->config);
        $this->hosting = new HostingService($this->transport, $this->config);
        $this->iam = new IamService($this->transport, $this->config);
        $this->members = new MembersService($this->transport, $this->config);
        $this->projects = new ProjectsService($this->transport);
        $this->redis = new RedisService($this->transport, $this->config);
        $this->registries = new RegistriesService($this->transport, $this->config);
        $this->secrets = new SecretsService($this->transport, $this->config);
        $this->servers = new ServersService($this->transport, $this->config);
        $this->sshKeys = new SshKeysService($this->transport, $this->config);
        $this->variables = new VariablesService($this->transport, $this->config);
        $this->webhooks = new WebhooksService($this->transport, $this->config);
    }
}
