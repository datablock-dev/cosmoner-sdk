<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** 429 — the caller exceeded a rate limit and should back off. */
class RateLimitError extends CosmonerError
{
    public function __construct(
        int $status,
        string $errorCode,
        string $message,
        mixed $details = null,
        ?string $requestId = null,
        public readonly ?float $retryAfter = null,
    ) {
        parent::__construct($status, $errorCode, $message, $details, $requestId);
    }
}
