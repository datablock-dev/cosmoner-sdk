<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * One field's type and constraints in the deployment file's field table.
 *
 * Keyword names mirror JSON Schema's so that `DeploymentDriftTest` can walk this
 * table and the published document side by side and fail on the first
 * difference. Renaming one to something more natural would cost that check,
 * which is the only thing keeping the table honest.
 *
 * @internal Part of how {@see Deployment} is checked, not of the SDK's surface.
 */
final class DeploymentField
{
    public const KIND_STRING = 'string';
    public const KIND_INTEGER = 'integer';
    public const KIND_BOOLEAN = 'boolean';
    public const KIND_CONST = 'const';
    public const KIND_OBJECT = 'object';
    public const KIND_ARRAY = 'array';

    /**
     * @param string                        $kind         One of the KIND_* constants.
     * @param bool                          $required     Absent is an error, not "not set".
     * @param bool                          $deprecated   Still read, reported as a warning.
     * @param string|null                   $replacedBy   The field that supersedes a
     *                                                    deprecated one. Named in the warning.
     * @param string|int|null               $default      What the platform reads when absent.
     * @param string|null                   $patternMessage Shown instead of a restatement of
     *                                                    the pattern. A regex is not something
     *                                                    to put in front of someone who
     *                                                    mistyped a service name.
     * @param list<string>|null             $enum
     * @param int|null                      $const        The single accepted value.
     * @param string|null                   $constMessage The message for a mismatch.
     * @param array<string,DeploymentField> $fields       For KIND_OBJECT.
     * @param string|null                   $minItemsMessage Replaces the generic wording.
     * @param DeploymentField|null          $items        For KIND_ARRAY.
     * @param string|null                   $rule         Which cross-field rule this mapping
     *                                                    carries. Named here rather than
     *                                                    matched on the table itself — as the
     *                                                    other two SDKs do — because a PHP
     *                                                    array is a value and has no identity
     *                                                    to match on.
     */
    public function __construct(
        public readonly string $kind,
        public readonly bool $required = false,
        public readonly bool $deprecated = false,
        public readonly ?string $replacedBy = null,
        public readonly string|int|null $default = null,
        public readonly ?int $minLength = null,
        public readonly ?int $maxLength = null,
        public readonly ?string $pattern = null,
        public readonly ?string $patternMessage = null,
        public readonly ?array $enum = null,
        public readonly ?int $minimum = null,
        public readonly ?int $maximum = null,
        public readonly ?int $const = null,
        public readonly ?string $constMessage = null,
        public readonly ?array $fields = null,
        public readonly ?int $minItems = null,
        public readonly ?string $minItemsMessage = null,
        public readonly ?int $maxItems = null,
        public readonly ?DeploymentField $items = null,
        public readonly ?string $rule = null,
    ) {
    }
}
