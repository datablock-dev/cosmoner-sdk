<?php

declare(strict_types=1);

namespace Datablock\Sdk;

class Datablock
{
    public readonly string $apiKey;
    public readonly string $projectId;
    public readonly string $baseUrl;

    public readonly EmailService $email;

    public function __construct(string $apiKey, string $projectId, string $baseUrl = 'https://api.datablock.dev')
    {
        if ($apiKey === '') {
            throw new \InvalidArgumentException('apiKey is required');
        }
        if ($projectId === '') {
            throw new \InvalidArgumentException('projectId is required');
        }

        $this->apiKey = $apiKey;
        $this->projectId = $projectId;
        $this->baseUrl = rtrim($baseUrl, '/');

        $this->email = new EmailService($this);
    }
}
