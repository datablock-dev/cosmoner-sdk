<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/** Immutable, validated connection settings shared by the client and its services. */
final class Config
{
    public const DEFAULT_BASE_URL = 'https://api.cosmoner.com';
    public const DEFAULT_TIMEOUT = 30.0;
    public const DEFAULT_MAX_RETRIES = 2;

    /** Base URL with any trailing slash removed. */
    public readonly string $baseUrl;

    /**
     * Validates constructor arguments and normalizes them.
     *
     * `$projectId` is optional so a single client can span projects, but an
     * explicitly empty string is rejected rather than silently treated as
     * unset — that almost always means an unresolved environment variable.
     */
    public function __construct(
        public readonly string $apiKey,
        public readonly ?string $projectId = null,
        string $baseUrl = self::DEFAULT_BASE_URL,
        public readonly float $timeout = self::DEFAULT_TIMEOUT,
        public readonly int $maxRetries = self::DEFAULT_MAX_RETRIES,
    ) {
        if ($apiKey === '') {
            throw new InvalidArgumentException('apiKey is required');
        }
        if ($projectId !== null && $projectId === '') {
            throw new InvalidArgumentException('projectId is required');
        }
        if ($timeout <= 0) {
            throw new InvalidArgumentException('timeout must be greater than 0');
        }
        if ($maxRetries < 0) {
            throw new InvalidArgumentException('maxRetries cannot be negative');
        }

        $this->baseUrl = rtrim($baseUrl, '/');
    }

    /** Returns the per-call project id, falling back to the client-level default. */
    public function resolveProjectId(?string $override = null): string
    {
        $projectId = ($override !== null && $override !== '') ? $override : $this->projectId;

        if ($projectId === null || $projectId === '') {
            throw new InvalidArgumentException(
                'projectId is required — pass it to the Cosmoner client or to this method'
            );
        }

        return $projectId;
    }
}
