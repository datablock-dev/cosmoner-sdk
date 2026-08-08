<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** The request never produced a response (DNS, TCP, TLS or socket failure). */
class CosmonerConnectionError extends CosmonerError
{
    public function __construct(string $message, string $errorCode = 'CONNECTION_ERROR')
    {
        parent::__construct(0, $errorCode, $message);
    }
}
