<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Prices, creates, reads and deletes a project's container registries.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-import-type CheckoutPreview from CatalogService
 * @phpstan-type RegistryProvider array{
 *     value: string,
 *     label: string,
 *     description: string,
 *     regions: list<array{value: string, label: string, ...}>,
 *     ...
 * }
 * @phpstan-type Repository array{
 *     id: string,
 *     name: string,
 *     fullPath: string,
 *     visibility: string,
 *     ...
 * }
 * @phpstan-type Registry array{
 *     id: string,
 *     name: string,
 *     provider: string,
 *     region: string,
 *     endpoint: ?string,
 *     status: string,
 *     namespaceName: ?string,
 *     repositories: list<Repository>,
 *     createdAt: string,
 *     ...
 * }
 */
class RegistriesService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists every container registry in the project with its repositories.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: list<Registry>}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<Registry>} */
        return $this->transport->request('GET', $this->basePath($projectId));
    }

    /**
     * Fetches one container registry with its repositories.
     *
     * @return array{success: true, data: Registry}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $registryId, ?string $projectId = null): array
    {
        self::requireRegistryId($registryId);

        /** @var array{success: true, data: Registry} */
        return $this->transport->request('GET', $this->basePath($projectId) . "/{$registryId}");
    }

    /**
     * Quotes the price of a container registry before it is created.
     *
     * Covers the base fee only: storage and egress are metered and not included.
     * Prices the monthly charge exactly. `dueToday` is an estimate for a project
     * that already has a subscription, because the real charge is prorated onto it.
     *
     * @return array{success: true, data: CheckoutPreview}
     *
     * @throws CosmonerError On API errors.
     */
    public function preview(?string $projectId = null): array
    {
        /** @var array{success: true, data: CheckoutPreview} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/preview');
    }

    /**
     * Lists the providers a registry can be created on, with each one's regions.
     *
     * @return array{success: true, data: list<RegistryProvider>}
     *
     * @throws CosmonerError On API errors.
     */
    public function providers(?string $projectId = null): array
    {
        /** @var array{success: true, data: list<RegistryProvider>} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/providers');
    }

    /**
     * Creates a container registry.
     *
     * Charges the project's saved card immediately (a prorated invoice). When the
     * project cannot be billed the API refuses with a 402 —
     * `ORG_PAYMENT_METHOD_REQUIRED`, `BILLER_PAYMENT_METHOD_REQUIRED` or
     * `PAYMENT_REQUIRED` — before anything is created.
     *
     * @param array{name: string, region: string, provider?: ?string} $params
     *     `provider` and `region` are `value`s from `providers()`; a provider left
     *     out takes the API's default.
     *
     * @return array{success: true, data: array{deployed: true, id: string}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function create(array $params, ?string $projectId = null): array
    {
        Params::check($params, ['name', 'region', 'provider'], ['name', 'region']);

        $body = ['name' => $params['name'], 'region' => $params['region']];
        if (isset($params['provider'])) {
            $body['provider'] = $params['provider'];
        }

        /** @var array{success: true, data: array{deployed: true, id: string}} */
        return $this->transport->request('POST', $this->basePath($projectId), $body);
    }

    /**
     * Permanently deletes a container registry with every repository and image in it.
     *
     * @return array{success: true, data: array{}}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function delete(string $registryId, ?string $projectId = null): array
    {
        self::requireRegistryId($registryId);

        /** @var array{success: true, data: array{}} */
        return $this->transport->request('DELETE', $this->basePath($projectId) . "/{$registryId}");
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/storage/container-registry';
    }

    /** Rejects an empty registry id before it becomes a malformed route. */
    private static function requireRegistryId(string $registryId): void
    {
        if ($registryId === '') {
            throw new InvalidArgumentException('registryId is required');
        }
    }
}
