<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use Composer\InstalledVersions;
use OutOfBoundsException;

/**
 * The SDK's own version, for the User-Agent header.
 *
 * Read from Composer rather than written down here. A constant is a second
 * place the version lives and there is nothing in this repository to check it
 * against — composer.json carries no `version` field, because Packagist takes
 * it from the git tag — so a hardcoded one goes stale quietly, as it had, by
 * two releases. Asking Composer what it installed cannot.
 *
 * The Python SDK reads `importlib.metadata` for the same reason. The JavaScript
 * one cannot: it is bundled into consumers' builds, where no manifest survives
 * to be read, so there the constant is written by the release workflow instead.
 */
final class Version
{
    /** The package name Composer knows this SDK by. */
    private const PACKAGE = 'cosmoner/sdk';

    /** Reported when there is no released version to report — see {@see self::get()}. */
    public const UNKNOWN = '0.0.0';

    private static ?string $cached = null;

    /**
     * Returns the installed version, or `0.0.0` when there is not one.
     *
     * A source checkout has no version: Composer answers for the root package
     * with its `1.0.0+no-version-set` placeholder, which would put a
     * plausible-looking `1.0.0` in the User-Agent and be worse than admitting
     * we do not know.
     */
    public static function get(): string
    {
        return self::$cached ??= self::resolve();
    }

    private static function resolve(): string
    {
        if (!class_exists(InstalledVersions::class)) {
            return self::UNKNOWN;
        }

        try {
            $version = InstalledVersions::getPrettyVersion(self::PACKAGE);
        } catch (OutOfBoundsException) {
            // Autoloaded some other way than by Composer installing us.
            return self::UNKNOWN;
        }

        if ($version === null || str_contains($version, '+no-version-set')) {
            return self::UNKNOWN;
        }

        // Versions come from git tags, which carry the `v` the tag was named
        // with. The User-Agent should not.
        return ltrim($version, 'v');
    }
}
