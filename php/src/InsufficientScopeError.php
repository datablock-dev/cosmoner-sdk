<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/** 403 — the API key lacks the required resource:action permission. */
class InsufficientScopeError extends CosmonerError
{
}
