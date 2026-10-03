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
    /**
     * @param ?string $docsUrl Page explaining how to fix the error. The API links
     *                         one only for errors the caller can fix, and older
     *                         API versions never do, so it is often null.
     */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly mixed $details = null,
        public readonly ?string $requestId = null,
        public readonly ?string $docsUrl = null,
    ) {
        parent::__construct($message, $status);
    }
}
