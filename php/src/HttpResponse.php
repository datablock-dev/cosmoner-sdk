<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** A raw HTTP response, before the SDK decodes or maps it. */
final class HttpResponse
{
    /**
     * @param array<string, string> $headers Header names lowercased.
     */
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly array $headers = [],
    ) {
    }

    /** Whether the status is in the 2xx range. */
    public function isSuccess(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }
}
