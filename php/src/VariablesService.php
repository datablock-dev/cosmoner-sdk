<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Manages a project's variables.
 *
 * Reads need the `variables:read` scope. Writes need `variables:write` *and*
 * an owner or admin: the API checks the member's role independently of the
 * key's scopes, so a plain member's key is refused even when it carries the
 * scope.
 *
 * Unlike a secret, a variable's value is returned in full on every read. That
 * is the difference between the two resources — anything worth hiding belongs
 * in `SecretsService`.
 */
class VariablesService
{
    /** The name rule the API enforces, mirrored here to save a round trip. */
    private const NAME_PATTERN = '/^[A-Z][A-Z0-9_]*$/';

    private const MAX_NAME_LENGTH = 100;
    private const MAX_VALUE_LENGTH = 10000;

    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists the project's variables, values included.
     *
     * @param string|null $environment One of `default`, `development`, `staging`
     *                                 or `production`. Null lists them all.
     * @param string|null $projectId   Overrides the client-level default project.
     *
     * @return array{success: true, data: array<int, array<string, mixed>>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $environment = null, ?string $projectId = null): array
    {
        /** @var array{success: true, data: array<int, array<string, mixed>>} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId),
            null,
            $environment !== null ? ['environment' => $environment] : [],
        );
    }

    /**
     * Fetches one variable, value included.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $variableId, ?string $projectId = null): array
    {
        self::requireVariableId($variableId);

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$variableId}");
    }

    /**
     * Stores a new variable.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(
        string $name,
        string $value,
        ?string $description = null,
        ?string $environment = null,
        ?string $projectId = null,
    ): array {
        self::requireName($name);
        self::requireValue($value);

        $body = ['name' => $name, 'value' => $value];
        if ($description !== null) {
            $body['description'] = $description;
        }
        if ($environment !== null) {
            $body['environment'] = $environment;
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
    }

    /**
     * Changes a variable's value, its description, or both.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function update(
        string $variableId,
        ?string $value = null,
        ?string $description = null,
        ?string $projectId = null,
    ): array {
        self::requireVariableId($variableId);

        if ($value === null && $description === null) {
            throw new InvalidArgumentException('Provide a value or description to update');
        }

        $body = [];
        if ($value !== null) {
            self::requireValue($value);
            $body['value'] = $value;
        }
        if ($description !== null) {
            $body['description'] = $description;
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'PATCH',
            $this->basePath($projectId) . "/{$variableId}",
            $body,
        );
    }

    /**
     * Permanently removes a variable. The API answers 204, so there is nothing to return.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $variableId, ?string $projectId = null): void
    {
        self::requireVariableId($variableId);

        $this->transport->request('DELETE', $this->basePath($projectId) . "/{$variableId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/variables';
    }

    /** Rejects an empty variable id before it becomes a malformed route. */
    private static function requireVariableId(string $variableId): void
    {
        if ($variableId === '') {
            throw new InvalidArgumentException('variableId is required');
        }
    }

    /** Rejects a name the API would reject, using the message the API would send. */
    private static function requireName(string $name): void
    {
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }
        if (preg_match(self::NAME_PATTERN, $name) !== 1) {
            throw new InvalidArgumentException(
                'Name must be uppercase letters, numbers, or underscores, '
                . 'and start with a letter (e.g. LOG_LEVEL)',
            );
        }
        if (strlen($name) > self::MAX_NAME_LENGTH) {
            throw new InvalidArgumentException(
                'name must be at most ' . self::MAX_NAME_LENGTH . ' characters',
            );
        }
    }

    /** Rejects a value the API would reject. */
    private static function requireValue(string $value): void
    {
        if ($value === '') {
            throw new InvalidArgumentException('value is required');
        }
        if (strlen($value) > self::MAX_VALUE_LENGTH) {
            throw new InvalidArgumentException(
                'value must be at most ' . self::MAX_VALUE_LENGTH . ' characters',
            );
        }
    }
}
