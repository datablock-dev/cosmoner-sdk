<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

/**
 * Validation of `.cosmoner/deployment.yaml`, the one file customers write by hand.
 *
 * Static rather than injected: the check needs no client, no credentials and no
 * network, so it can run in a script that generates the file or a CI job that
 * guards it. It is in the SDK for that reason, not because it talks to the API.
 *
 * What it reports is what the platform will do with the file, which is not the
 * same as what the file says. The platform's parser is deliberately lenient —
 * an unknown key is dropped so a file written for a newer field still applies
 * its known settings against an older deploy — so an unknown key here is a
 * warning naming that consequence, and the result's `template` holds the
 * settings that will actually arrive.
 *
 * The field table below is the third description of this format, after the
 * platform's Zod schema and the JSON Schema compiled from it. `schemas/README.md`
 * explains why it is hand-written rather than fed to a JSON Schema validator,
 * and `DeploymentDriftTest` is what stops it drifting.
 */
final class Deployment
{
    /** Where the platform serves the JSON Schema this table mirrors. */
    public const APP_SCHEMA_URL = 'https://cosmoner.com/schemas/app.schema.json';

    /** The format version this SDK reads. */
    public const VERSION = 1;

    /** Files larger than this are refused rather than parsed, as the platform does. */
    public const MAX_BYTES = 64 * 1024;

    /**
     * Where the platform looks for the file, in order, when a repository is
     * selected in the deploy wizard. The first one that exists is the one that
     * counts — a second copy further down this list is never read.
     *
     * `.datablock/app.*` is the original location. It is still read and still
     * last, so apps already filled from it keep working; new files should not
     * use it.
     *
     * @var list<string>
     */
    public const FILE_PATHS = [
        '.cosmoner/deployment.yaml',
        '.cosmoner/deployment.yml',
        'deployment.yaml',
        'deployment.yml',
        '.datablock/app.yaml',
        '.datablock/app.yml',
    ];

    /** How a variable's name may be written in the app's own environment. */
    private const ENV_KEY_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';

    /**
     * How a stored secret or variable is named. Stricter than the above because
     * it is not this file's rule: it is what the vault accepts, so a reference
     * that could not name an existing secret is a typo worth catching before
     * the push rather than at deploy time.
     */
    private const REF_PATTERN = '^[A-Z][A-Z0-9_]*$';

    private const RULE_ENV = 'env';
    private const RULE_SERVICE = 'service';

    /**
     * Fields of one entry under a service's `envs`.
     *
     * @return array<string,DeploymentField>
     */
    public static function envFields(): array
    {
        return [
            'key' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                required: true,
                minLength: 1,
                maxLength: 256,
                pattern: self::ENV_KEY_PATTERN,
                patternMessage: 'Env var keys must start with a letter or underscore and contain '
                    . 'only letters, numbers, or underscores',
            ),
            'value' => new DeploymentField(kind: DeploymentField::KIND_STRING),
            'secret' => new DeploymentField(kind: DeploymentField::KIND_BOOLEAN),
            'from_variable' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                minLength: 1,
                maxLength: 100,
                pattern: self::REF_PATTERN,
                patternMessage: 'from_variable must name a project variable, e.g. PUBLIC_API_URL',
            ),
            'from_secret' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                minLength: 1,
                maxLength: 100,
                pattern: self::REF_PATTERN,
                patternMessage: 'from_secret must name a stored secret, e.g. DATABASE_PASSWORD',
            ),
        ];
    }

    /**
     * Fields of a service's `build` mapping.
     *
     * @return array<string,DeploymentField>
     */
    public static function buildFields(): array
    {
        return [
            'strategy' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                enum: ['nixpacks', 'docker'],
            ),
            'command' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 1024),
            'output_dir' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 512),
        ];
    }

    /**
     * Fields of one entry under `services`.
     *
     * @return array<string,DeploymentField>
     */
    public static function serviceFields(): array
    {
        return [
            'name' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                required: true,
                minLength: 1,
                maxLength: 32,
                pattern: '^[a-z0-9][a-z0-9-]*$',
                patternMessage: 'Service names must be lowercase letters, numbers, or hyphens, '
                    . 'and start with a letter or number',
            ),
            'type' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                default: 'service',
                enum: ['service', 'static'],
            ),
            'source_dir' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 512),
            'build' => new DeploymentField(
                kind: DeploymentField::KIND_OBJECT,
                fields: self::buildFields(),
            ),
            'run_command' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 1024),
            'port' => new DeploymentField(kind: DeploymentField::KIND_INTEGER, minimum: 1, maximum: 65535),
            'http_port' => new DeploymentField(
                kind: DeploymentField::KIND_INTEGER,
                deprecated: true,
                replacedBy: 'port',
                minimum: 1,
                maximum: 65535,
            ),
            'internal_port' => new DeploymentField(
                kind: DeploymentField::KIND_INTEGER,
                deprecated: true,
                replacedBy: 'port',
                minimum: 1,
                maximum: 65535,
            ),
            'instance_size' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 64),
            'instances' => new DeploymentField(kind: DeploymentField::KIND_INTEGER, minimum: 1, maximum: 10),
            'autodeploy' => new DeploymentField(kind: DeploymentField::KIND_BOOLEAN),
            'envs' => new DeploymentField(
                kind: DeploymentField::KIND_ARRAY,
                maxItems: 100,
                items: new DeploymentField(
                    kind: DeploymentField::KIND_OBJECT,
                    fields: self::envFields(),
                    rule: self::RULE_ENV,
                ),
            ),
        ];
    }

    /**
     * Fields of the document itself.
     *
     * @return array<string,DeploymentField>
     */
    public static function rootFields(): array
    {
        return [
            '$schema' => new DeploymentField(kind: DeploymentField::KIND_STRING),
            'version' => new DeploymentField(
                kind: DeploymentField::KIND_CONST,
                default: self::VERSION,
                const: self::VERSION,
                constMessage: 'Unsupported file version — this platform reads version '
                    . self::VERSION . ' files',
            ),
            'name' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 100),
            'region' => new DeploymentField(kind: DeploymentField::KIND_STRING, maxLength: 32),
            'environment' => new DeploymentField(
                kind: DeploymentField::KIND_STRING,
                enum: ['default', 'development', 'staging', 'production'],
            ),
            'services' => new DeploymentField(
                kind: DeploymentField::KIND_ARRAY,
                required: true,
                minItems: 1,
                minItemsMessage: 'At least one service is required',
                maxItems: 10,
                items: new DeploymentField(
                    kind: DeploymentField::KIND_OBJECT,
                    fields: self::serviceFields(),
                    rule: self::RULE_SERVICE,
                ),
            ),
        ];
    }

    /**
     * Reads and validates the contents of a deployment file.
     *
     * @param string $source The file as written — the raw text, not a parsed value.
     * @param bool   $strict Treat warnings as errors, for a CI check that should
     *                       not let typos through.
     */
    public static function validate(string $source, bool $strict = false): DeploymentValidationResult
    {
        /** @var list<DeploymentIssue> $issues */
        $issues = [];

        if (strlen($source) > self::MAX_BYTES) {
            self::error($issues, [], 'File exceeds the ' . (self::MAX_BYTES / 1024) . ' KiB limit');
            return self::result($issues, null, $strict);
        }

        try {
            $document = Yaml::parse($source);
        } catch (ParseException $err) {
            self::error($issues, [], 'Invalid YAML: ' . $err->getMessage());
            return self::result($issues, null, $strict);
        }

        return self::validateDocument($document, $strict);
    }

    /**
     * Validates an already-parsed document.
     *
     * Use this when the file did not come from disk — generated from a template,
     * or read out of a repository through some other client. {@see self::validate()}
     * is the same check with the YAML parsing in front of it.
     */
    public static function validateDocument(mixed $document, bool $strict = false): DeploymentValidationResult
    {
        /** @var list<DeploymentIssue> $issues */
        $issues = [];

        if ($document === null) {
            self::error($issues, [], 'File is empty');
            return self::result($issues, null, $strict);
        }
        if (!self::isMapping($document)) {
            self::error($issues, [], 'Expected a mapping at the top level of the file');
            return self::result($issues, null, $strict);
        }

        $parsed = self::checkMapping($document, self::rootFields(), [], $issues);
        self::checkRoot($parsed, [], $issues);

        return self::result($issues, $parsed, $strict);
    }

    /**
     * Checks one value against its spec.
     *
     * Returns the value to carry into the parsed template, or null when it
     * failed — which also takes it out of the cross-field rules below. A `port`
     * that is not a number has nothing useful to say about whether it conflicts
     * with `http_port`, and saying it anyway buries the one message worth reading.
     *
     * @param list<string|int>      $path
     * @param list<DeploymentIssue> $issues
     */
    private static function checkValue(mixed $value, DeploymentField $spec, array $path, array &$issues): mixed
    {
        switch ($spec->kind) {
            case DeploymentField::KIND_STRING:
                if (!is_string($value)) {
                    self::error($issues, $path, 'Expected a string');
                    return null;
                }
                if ($spec->enum !== null && !in_array($value, $spec->enum, true)) {
                    self::error($issues, $path, 'Must be one of: ' . implode(', ', $spec->enum));
                    return null;
                }
                if ($spec->minLength !== null && mb_strlen($value) < $spec->minLength) {
                    self::error($issues, $path, 'Must not be empty');
                    return null;
                }
                if ($spec->maxLength !== null && mb_strlen($value) > $spec->maxLength) {
                    self::error($issues, $path, 'Must be at most ' . $spec->maxLength . ' characters');
                    return null;
                }
                if ($spec->pattern !== null && preg_match('/' . $spec->pattern . '/', $value) !== 1) {
                    self::error($issues, $path, $spec->patternMessage ?? 'Must match ' . $spec->pattern);
                    return null;
                }
                return $value;

            case DeploymentField::KIND_INTEGER:
                if (!is_int($value)) {
                    self::error($issues, $path, 'Expected an integer');
                    return null;
                }
                if ($value < (int) $spec->minimum || $value > (int) $spec->maximum) {
                    self::error(
                        $issues,
                        $path,
                        'Must be between ' . $spec->minimum . ' and ' . $spec->maximum
                    );
                    return null;
                }
                return $value;

            case DeploymentField::KIND_BOOLEAN:
                if (!is_bool($value)) {
                    self::error($issues, $path, 'Expected a boolean');
                    return null;
                }
                return $value;

            case DeploymentField::KIND_CONST:
                if ($value !== $spec->const) {
                    self::error($issues, $path, $spec->constMessage ?? 'Unsupported value');
                    return null;
                }
                return $value;

            case DeploymentField::KIND_OBJECT:
                if (!self::isMapping($value)) {
                    self::error($issues, $path, 'Expected a mapping');
                    return null;
                }
                $parsed = self::checkMapping($value, $spec->fields ?? [], $path, $issues);
                // The rules that span more than one field run as part of the
                // mapping they belong to, so a bad variable is reported above
                // the service holding it rather than in a pass at the end.
                if ($spec->rule === self::RULE_ENV) {
                    self::checkEnvVar($parsed, $value, $path, $issues);
                } elseif ($spec->rule === self::RULE_SERVICE) {
                    self::checkService($parsed, $path, $issues);
                }
                return $parsed;

            case DeploymentField::KIND_ARRAY:
                if (!is_array($value) || !array_is_list($value)) {
                    self::error($issues, $path, 'Expected a list');
                    return null;
                }
                if ($spec->minItems !== null && count($value) < $spec->minItems) {
                    self::error(
                        $issues,
                        $path,
                        $spec->minItemsMessage ?? 'Must have at least ' . $spec->minItems . ' items'
                    );
                    return null;
                }
                if ($spec->maxItems !== null && count($value) > $spec->maxItems) {
                    self::error($issues, $path, 'Must have at most ' . $spec->maxItems . ' items');
                    return null;
                }
                $items = [];
                foreach ($value as $index => $item) {
                    $items[] = self::checkValue(
                        $item,
                        $spec->items ?? new DeploymentField(kind: DeploymentField::KIND_STRING),
                        [...$path, $index],
                        $issues
                    );
                }
                return $items;
        }

        return null;
    }

    /**
     * Checks a mapping's keys against a field table.
     *
     * Unknown keys are reported first so a typo appears above the fields it sits
     * among, then the known fields in table order, so output reads down the file
     * rather than in whatever order the rules happen to fire.
     *
     * @param array<string,mixed>           $value
     * @param array<string,DeploymentField> $table
     * @param list<string|int>              $path
     * @param list<DeploymentIssue>         $issues
     *
     * @return array<string,mixed>
     */
    private static function checkMapping(array $value, array $table, array $path, array &$issues): array
    {
        foreach (array_keys($value) as $key) {
            if (!array_key_exists($key, $table)) {
                self::warn($issues, [...$path, $key], 'Unknown field "' . $key . '" — it will be ignored');
            }
        }

        $parsed = [];
        foreach ($table as $key => $spec) {
            $fieldPath = [...$path, $key];
            if (!array_key_exists($key, $value) || $value[$key] === null) {
                if ($spec->required) {
                    self::error($issues, $fieldPath, 'Required');
                } elseif ($spec->default !== null) {
                    $parsed[$key] = $spec->default;
                }
                continue;
            }
            if ($spec->deprecated && $spec->replacedBy !== null) {
                self::warn($issues, $fieldPath, $key . ' is deprecated — use ' . $spec->replacedBy);
            }
            $checked = self::checkValue($value[$key], $spec, $fieldPath, $issues);
            if ($checked !== null) {
                $parsed[$key] = $checked;
            }
        }
        return $parsed;
    }

    /**
     * Rules spanning more than one field of an `envs` entry.
     *
     * A variable takes its value from exactly one place. Two sources is not a
     * merge with a winner — it is a file whose author believed something the
     * platform does not do — so it is refused rather than quietly resolved.
     *
     * Which sources were given is read from `$raw`, not from the checked values:
     * a `from_variable` that failed its pattern is still a source the author
     * supplied, and answering a typo in it with "set one of value, secret,
     * from_variable, or from_secret" buries the message that would fix the file.
     *
     * @param array<string,mixed>   $env
     * @param array<string,mixed>   $raw
     * @param list<string|int>      $path
     * @param list<DeploymentIssue> $issues
     */
    private static function checkEnvVar(array $env, array $raw, array $path, array &$issues): void
    {
        $sources = [];
        foreach (['value', 'secret', 'from_variable', 'from_secret'] as $key) {
            // `secret: false` says the variable is not sensitive; it is not an
            // attempt to give it a value, so it does not count as a source.
            $supplied = $key === 'secret'
                ? ($raw['secret'] ?? null) === true
                : ($raw[$key] ?? null) !== null;
            if ($supplied) {
                $sources[] = $key;
            }
        }

        if ($sources === []) {
            self::error(
                $issues,
                [...$path, 'value'],
                'Set one of value, secret, from_variable, or from_secret'
            );
            return;
        }
        if (count($sources) > 1) {
            self::error(
                $issues,
                [...$path, $sources[1]],
                'A variable takes its value from one place only — remove '
                    . implode(', ', array_slice($sources, 1))
            );
        }
        // `secret: true` with a value is the mistake this check exists for: a
        // credential committed to the repository. Said plainly and separately,
        // so the author knows to rotate it rather than just to delete a line.
        if (($env['secret'] ?? null) === true && ($env['value'] ?? null) !== null) {
            self::error(
                $issues,
                [...$path, 'value'],
                'A secret value must not be committed — remove value, or link a stored secret with from_secret'
            );
        }
    }

    /**
     * Rules spanning more than one field of a service.
     *
     * @param array<string,mixed>   $service
     * @param list<string|int>      $path
     * @param list<DeploymentIssue> $issues
     */
    private static function checkService(array $service, array $path, array &$issues): void
    {
        $isStatic = ($service['type'] ?? null) === 'static';
        $rawBuild = $service['build'] ?? null;
        $build = self::isMapping($rawBuild) ? $rawBuild : null;

        if ($isStatic && ($service['run_command'] ?? null) !== null) {
            self::error($issues, [...$path, 'run_command'], 'Static sites cannot define a run_command');
        }
        if (!$isStatic && $build !== null && ($build['output_dir'] ?? null) !== null) {
            self::error($issues, [...$path, 'build', 'output_dir'], 'output_dir only applies to static sites');
        }
        // A static site not built from its own Dockerfile runs the platform's
        // image, whose port is not the customer's to choose.
        $strategy = $build !== null ? ($build['strategy'] ?? null) : null;
        if ($isStatic && $strategy !== 'docker' && ($service['port'] ?? null) !== null) {
            self::error(
                $issues,
                [...$path, 'port'],
                'port does not apply to a static site — the platform serves it'
            );
        }

        $legacy = [];
        foreach (['http_port', 'internal_port'] as $key) {
            if (($service[$key] ?? null) !== null) {
                $legacy[] = $key;
            }
        }
        if (($service['port'] ?? null) !== null && $legacy !== []) {
            self::error(
                $issues,
                [...$path, $legacy[0]],
                'port replaces ' . implode(' and ', $legacy)
                    . ' — remove ' . (count($legacy) === 1 ? 'it' : 'them')
            );
        }

        $envs = $service['envs'] ?? null;
        if (is_array($envs)) {
            $seen = [];
            foreach ($envs as $index => $env) {
                if (!self::isMapping($env)) {
                    continue;
                }
                $name = $env['key'] ?? null;
                if (!is_string($name)) {
                    continue;
                }
                if (in_array($name, $seen, true)) {
                    self::error(
                        $issues,
                        [...$path, 'envs', $index, 'key'],
                        'Duplicate environment variable "' . $name . '"'
                    );
                }
                $seen[] = $name;
            }
        }
    }

    /**
     * Rules spanning more than one field of the document itself.
     *
     * @param array<string,mixed>   $document
     * @param list<string|int>      $path
     * @param list<DeploymentIssue> $issues
     */
    private static function checkRoot(array $document, array $path, array &$issues): void
    {
        $services = $document['services'] ?? null;
        if (!is_array($services)) {
            return;
        }

        $seen = [];
        foreach ($services as $index => $service) {
            if (!self::isMapping($service)) {
                continue;
            }
            $name = $service['name'] ?? null;
            if (!is_string($name)) {
                continue;
            }
            if (in_array($name, $seen, true)) {
                self::error(
                    $issues,
                    [...$path, 'services', $index, 'name'],
                    'Duplicate service name "' . $name . '"'
                );
            }
            $seen[] = $name;
        }
    }

    /**
     * Assembles the result.
     *
     * `template` follows the errors rather than `valid`: it is what the platform
     * would read, which strict does not change — strict is about what this caller
     * is willing to let through, not about what the platform does.
     *
     * @param list<DeploymentIssue>    $issues
     * @param array<string,mixed>|null $template
     */
    private static function result(array $issues, ?array $template, bool $strict): DeploymentValidationResult
    {
        $hasErrors = false;
        foreach ($issues as $issue) {
            if ($issue->isError()) {
                $hasErrors = true;
                break;
            }
        }
        $blocking = $strict ? $issues !== [] : $hasErrors;

        return new DeploymentValidationResult(!$blocking, $issues, $hasErrors ? null : $template);
    }

    /**
     * Mapping-or-not. YAML gives lists as PHP lists, which are not mappings here.
     *
     * @phpstan-assert-if-true array<string,mixed> $value
     */
    private static function isMapping(mixed $value): bool
    {
        return is_array($value) && !array_is_list($value);
    }

    /**
     * @param list<DeploymentIssue> $issues
     * @param list<string|int>      $path
     */
    private static function error(array &$issues, array $path, string $message): void
    {
        $issues[] = new DeploymentIssue(self::formatPath($path), $message, DeploymentIssue::SEVERITY_ERROR);
    }

    /**
     * @param list<DeploymentIssue> $issues
     * @param list<string|int>      $path
     */
    private static function warn(array &$issues, array $path, string $message): void
    {
        $issues[] = new DeploymentIssue(self::formatPath($path), $message, DeploymentIssue::SEVERITY_WARNING);
    }

    /**
     * Renders a location the way the conformance suite and the CLI both expect it.
     *
     * @param list<string|int> $path
     */
    private static function formatPath(array $path): string
    {
        return $path === [] ? '(root)' : implode('.', array_map(strval(...), $path));
    }
}
