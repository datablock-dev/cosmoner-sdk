<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Checks the `$params` array a multi-field method takes, before any request.
 *
 * @internal Shared by the services; not part of the public API.
 */
final class Params
{
    /**
     * Rejects a key the method does not take, then an empty or missing required one.
     *
     * Unknown keys are refused rather than dropped, so a misspelt option such
     * as `ssh_key_ids` fails here instead of being silently left off an order.
     *
     * @param array<string, mixed> $params
     * @param list<string>         $allowed  Every key the method takes, required ones included.
     * @param list<string>         $required Keys that must be present and non-empty, in check order.
     *
     * @throws InvalidArgumentException On invalid input.
     */
    public static function check(array $params, array $allowed, array $required): void
    {
        $unknown = array_diff(array_keys($params), $allowed);
        if ($unknown !== []) {
            throw new InvalidArgumentException('Unknown field "' . implode('", "', $unknown) . '"');
        }
        foreach ($required as $key) {
            if (!isset($params[$key]) || $params[$key] === '') {
                throw new InvalidArgumentException("{$key} is required");
            }
        }
    }
}
