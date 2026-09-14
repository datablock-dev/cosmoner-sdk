<?php

declare(strict_types=1);

namespace Cosmoner\Sdk\Tests;

use Cosmoner\Sdk\Deployment;
use Cosmoner\Sdk\DeploymentField;
use PHPUnit\Framework\TestCase;

/**
 * Holds the field table to the platform's published JSON Schema.
 *
 * `schemas/app-schema.json` is a verbatim copy of what the platform serves, and
 * CI checks that the copy is current. This walks it against the table in
 * {@see Deployment} so that a field added, retyped, re-bounded or deprecated
 * upstream fails here instead of being discovered by a customer whose valid file
 * this SDK calls invalid.
 *
 * It deliberately says nothing about the cross-field rules — JSON Schema cannot
 * express them, which is why they are hand-written. The conformance suite pins
 * those.
 */
final class DeploymentDriftTest extends TestCase
{
    /**
     * @return array<string,mixed>
     */
    private static function schema(): array
    {
        $raw = file_get_contents(__DIR__ . '/../../schemas/app-schema.json');
        self::assertIsString($raw);

        /** @var array<string,mixed> $decoded */
        $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        return $decoded;
    }

    /**
     * Compares one field table against the schema node that should describe it.
     *
     * @param array<string,DeploymentField> $table
     * @param array<string,mixed>           $node
     */
    private static function assertTableMatches(array $table, array $node, string $where): void
    {
        /** @var array<string,mixed> $properties */
        $properties = $node['properties'];

        $tableKeys = array_keys($table);
        $schemaKeys = array_keys($properties);
        sort($tableKeys);
        sort($schemaKeys);
        self::assertSame($schemaKeys, $tableKeys, $where . ': field names');

        /** @var list<string> $required */
        $required = $node['required'] ?? [];

        foreach ($table as $key => $spec) {
            /** @var array<string,mixed> $field */
            $field = $properties[$key];
            $at = $where . '.' . $key;

            self::assertSame(in_array($key, $required, true), $spec->required, $at . ': required');
            self::assertSame(
                ($field['deprecated'] ?? null) === true,
                $spec->deprecated,
                $at . ': deprecated'
            );
            self::assertSame($field['default'] ?? null, $spec->default, $at . ': default');

            switch ($spec->kind) {
                case DeploymentField::KIND_STRING:
                    self::assertSame('string', $field['type'], $at . ': type');
                    self::assertSame($field['minLength'] ?? null, $spec->minLength, $at . ': minLength');
                    self::assertSame($field['maxLength'] ?? null, $spec->maxLength, $at . ': maxLength');
                    self::assertSame($field['pattern'] ?? null, $spec->pattern, $at . ': pattern');
                    self::assertSame($field['enum'] ?? null, $spec->enum, $at . ': enum');
                    break;
                case DeploymentField::KIND_INTEGER:
                    self::assertSame('integer', $field['type'], $at . ': type');
                    self::assertSame($field['minimum'] ?? null, $spec->minimum, $at . ': minimum');
                    self::assertSame($field['maximum'] ?? null, $spec->maximum, $at . ': maximum');
                    break;
                case DeploymentField::KIND_BOOLEAN:
                    self::assertSame('boolean', $field['type'], $at . ': type');
                    break;
                case DeploymentField::KIND_CONST:
                    self::assertSame($field['const'] ?? null, $spec->const, $at . ': const');
                    break;
                case DeploymentField::KIND_OBJECT:
                    self::assertSame('object', $field['type'], $at . ': type');
                    self::assertIsArray($spec->fields);
                    self::assertTableMatches($spec->fields, $field, $at);
                    break;
                case DeploymentField::KIND_ARRAY:
                    self::assertSame('array', $field['type'], $at . ': type');
                    self::assertSame($field['minItems'] ?? null, $spec->minItems, $at . ': minItems');
                    self::assertSame($field['maxItems'] ?? null, $spec->maxItems, $at . ': maxItems');
                    self::assertInstanceOf(DeploymentField::class, $spec->items);
                    self::assertIsArray($spec->items->fields);
                    /** @var array<string,mixed> $items */
                    $items = $field['items'];
                    self::assertTableMatches($spec->items->fields, $items, $at . '[]');
                    break;
                default:
                    self::fail($at . ': unknown kind ' . $spec->kind);
            }
        }
    }

    public function testIsTheSchemaThisSdkClaimsToImplement(): void
    {
        self::assertSame(Deployment::APP_SCHEMA_URL, self::schema()['$id']);
    }

    public function testDescribesTheSameDocument(): void
    {
        self::assertTableMatches(Deployment::rootFields(), self::schema(), 'root');
    }

    public function testWalkReachesTheNestedTables(): void
    {
        // assertTableMatches recurses, so the tables below the root are already
        // compared. Naming them keeps the assertion honest if the document is
        // ever restructured so the walk no longer reaches them.
        self::assertArrayHasKey('build', Deployment::serviceFields());
        self::assertArrayHasKey('envs', Deployment::serviceFields());
        self::assertNotEmpty(Deployment::buildFields());
        self::assertNotEmpty(Deployment::envFields());
    }
}
