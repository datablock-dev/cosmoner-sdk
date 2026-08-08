<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use RuntimeException;

/**
 * Base class for every error the SDK raises.
 *
 * Catching this catches all API and transport failures, so existing
 * `catch (CosmonerError $e)` blocks keep working as the hierarchy grows.
 */
class CosmonerError extends RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly mixed $details = null,
        public readonly ?string $requestId = null,
    ) {
        parent::__construct($message, $status);
    }
}
