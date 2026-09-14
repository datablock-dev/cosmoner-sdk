<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Deployment;
use Cosmoner\Sdk\DeploymentIssue;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Runs the shared fixtures in `conformance/`, which the JavaScript and Python
 * suites run too. See that directory's README for why the assertions are exact.
 */
final class DeploymentConformanceTest extends TestCase
{
    private const CONFORMANCE_DIR = __DIR__ . '/../../conformance';

    /**
     * @return array<string,array{array<string,mixed>}>
     */
    public static function cases(): array
    {
        $raw = file_get_contents(self::CONFORMANCE_DIR . '/cases.json');
        self::assertIsString($raw);

        /** @var array{cases: list<array<string,mixed>>} $decoded */
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

        $cases = [];
        foreach ($decoded['cases'] as $case) {
            /** @var string $name */
            $name = $case['name'];
            $cases[$name] = [$case];
        }
        return $cases;
    }

    /**
     * @param array<string,mixed> $case
     */
    #[DataProvider('cases')]
    public function testConformance(array $case): void
    {
        $name = $case['name'];
        self::assertIsString($name);

        $source = file_get_contents(self::CONFORMANCE_DIR . '/cases/' . $name . '.yaml');
        self::assertIsString($source);

        $result = Deployment::validate($source);

        /** @var list<array<string,string>> $expected */
        $expected = $case['issues'];

        $actualKeys = array_map(
            static fn(DeploymentIssue $issue) => $issue->severity . ' ' . $issue->path,
            $result->issues
        );
        $expectedKeys = array_map(
            static fn(array $issue) => $issue['severity'] . ' ' . $issue['path'],
            $expected
        );
        self::assertSame($expectedKeys, $actualKeys);

        foreach ($result->issues as $index => $issue) {
            // Read into a local and compared against '' so that the type is a
            // non-empty-string by the time assertStringStartsWith sees it.
            $prefix = $expected[$index]['messageStartsWith'] ?? '';
            if ($prefix !== '') {
                self::assertStringStartsWith($prefix, $issue->message);
            } else {
                self::assertSame($expected[$index]['message'], $issue->message);
            }
        }

        self::assertSame($case['valid'], $result->valid);

        // A file the platform cannot read has nothing to hand back.
        $hasErrors = false;
        foreach ($expected as $issue) {
            $hasErrors = $hasErrors || $issue['severity'] === 'error';
        }
        self::assertSame($hasErrors, $result->template === null);
    }

    public function testEveryFixtureHasAnExpectation(): void
    {
        // A fixture nothing lists in cases.json would otherwise sit there unrun,
        // looking like coverage it is not providing.
        $fixtures = glob(self::CONFORMANCE_DIR . '/cases/*.yaml');
        self::assertIsArray($fixtures);

        $fixtureNames = array_map(static fn(string $p) => basename($p, '.yaml'), $fixtures);
        sort($fixtureNames);

        $caseNames = array_keys(self::cases());
        sort($caseNames);

        self::assertSame($fixtureNames, $caseNames);
    }
}
