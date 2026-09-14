<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Version;
use PHPUnit\Framework\TestCase;

/**
 * The version is read from Composer rather than written down, so there is no
 * constant here to compare against — that is the point. What these check is
 * that it reports something usable, and that a source checkout is reported
 * honestly rather than as a plausible-looking release.
 */
final class VersionTest extends TestCase
{
    public function testReportsAVersionNumber(): void
    {
        self::assertMatchesRegularExpression('/^\d+\.\d+\.\d+/', Version::get());
    }

    public function testDoesNotCarryTheTagsVPrefix(): void
    {
        // Composer answers with the git tag, which is named php/vX.Y.Z.
        self::assertStringStartsNotWith('v', Version::get());
    }

    public function testDoesNotReportComposersPlaceholderAsARelease(): void
    {
        // Running from a checkout, Composer answers for the root package with
        // `1.0.0+no-version-set`. Passing that through would put a
        // plausible-looking 1.0.0 in the User-Agent of every request.
        self::assertStringNotContainsString('+', Version::get());
    }

    public function testIsStable(): void
    {
        self::assertSame(Version::get(), Version::get());
    }
}
