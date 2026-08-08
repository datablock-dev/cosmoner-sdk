<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** The request exceeded the configured timeout. */
class CosmonerTimeoutError extends CosmonerConnectionError
{
    public function __construct(string $message)
    {
        parent::__construct($message, 'TIMEOUT');
    }
}
