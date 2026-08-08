<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * A received webhook could not be verified against its signing secret.
 *
 * Unlike the rest of the hierarchy this never comes from an API response — it
 * is raised locally while checking an inbound request, so it carries no
 * meaningful HTTP status.
 */
class WebhookSignatureError extends CosmonerError
{
    public function __construct(string $message)
    {
        parent::__construct(0, 'WEBHOOK_SIGNATURE_INVALID', $message);
    }
}
