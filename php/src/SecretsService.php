<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Manages a project's secrets.
 *
 * Reads need the `secrets:read` scope. Writes need `secrets:write` *and* an
 * owner or admin: the API checks the member's role independently of the key's
 * scopes, so a plain member's key is refused even when it carries the scope.
 *
 * A secret's value is returned exactly once, by the call that sets it. No
 * route decrypts one afterwards.
 */
class SecretsService
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
     * Lists the project's secrets as metadata. Values are never included.
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
     * Fetches one secret's metadata. The value is not part of the response.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $secretId, ?string $projectId = null): array
    {
        self::requireSecretId($secretId);

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$secretId}");
    }

    /**
     * Stores a new secret, and returns its plaintext value once.
     *
     * The response carries `value` and `maskedValue`; a later read gives
     * metadata only, so store the value now rather than expect to recover it.
     *
     * Creation is rate-limited to 10 requests per 10 minutes, and a project at
     * its secret limit answers 402 — see `usage()`.
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
     * Replaces a secret's value, bumps its version, and returns the new value once.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function update(
        string $secretId,
        string $value,
        ?string $description = null,
        ?string $projectId = null,
    ): array {
        self::requireSecretId($secretId);
        self::requireValue($value);

        $body = ['value' => $value];
        if ($description !== null) {
            $body['description'] = $description;
        }

        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request(
            'PATCH',
            $this->basePath($projectId) . "/{$secretId}",
            $body,
        );
    }

    /**
     * Permanently removes a secret. The API answers 204, so there is nothing to return.
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $secretId, ?string $projectId = null): void
    {
        self::requireSecretId($secretId);

        $this->transport->request('DELETE', $this->basePath($projectId) . "/{$secretId}");
    }

    /**
     * Reports how many secrets the project holds, may hold, and the price of more.
     *
     * @return array{success: true, data: array<string, mixed>}
     *
     * @throws CosmonerError On API errors.
     */
    public function usage(?string $projectId = null): array
    {
        /** @var array{success: true, data: array<string, mixed>} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/usage');
    }

    /**
     * Reads a secret's audit trail: who changed it and when, never to what.
     *
     * @return array{success: true, data: array<int, array<string, mixed>>}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function audit(string $secretId, ?string $projectId = null): array
    {
        self::requireSecretId($secretId);

        /** @var array{success: true, data: array<int, array<string, mixed>>} */
        return $this->transport->request(
            'GET',
            $this->basePath($projectId) . "/{$secretId}/audit",
        );
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/secrets';
    }

    /** Rejects an empty secret id before it becomes a malformed route. */
    private static function requireSecretId(string $secretId): void
    {
        if ($secretId === '') {
            throw new InvalidArgumentException('secretId is required');
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
                . 'and start with a letter (e.g. DB_PASSWORD)',
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
